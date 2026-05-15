const { llamarJSONMini } = require("./openai_client");
const fs = require("fs");
const path = require("path");

const PROMPT = fs.readFileSync(path.join(__dirname, "../prompts/agente_qa.md"), "utf8");

function contarPalabras(texto) {
  return texto.trim().split(/\s+/).filter(Boolean).length;
}

function contarEmojis(texto) {
  // Matches emoji presentation characters
  return (texto.match(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu) || []).length;
}

// Cuenta solo signos de CIERRE de pregunta (?) — no el de apertura (¿)
function contarPreguntasCierre(texto) {
  return (texto.match(/\?/g) || []).length;
}

// Patrones de razones de rechazo VÁLIDAS (deben matchear alguna regla real)
const PATRONES_RECHAZO_VALIDO = [
  /más de 35 palabras|demasiado largo|conteo_palabras|supera.*máximo/i,
  /más de 2 oraciones|oraciones.*excede/i,
  /más de 1.*pregunta|múltiples.*preguntas|\d+.*signos.*interrogac/i,
  /precio.*bajo.*mínimo|mínimo.*precio|debajo.*mínimo|\$\d+.*menor.*mínimo/i,
  /datos bancarios/i,
  /\bIA\b|\bbot\b|sistema automatizado|menciona.*IA|dice.*bot/i,
  /descuento antes de.*valor|ofrece.*descuento.*antes/i,
  /Erika.*MARKETAS|MARKETAS.*Erika|mezcla.*cuenta/i,
  /ofrece.*servicios? fuera.*catalogo.*(?:tenemos|disponemos|incluimos)/i,
  /servicios? fuera de catalogo.*(ofrec|incluy|promete)/i,
  /cliente.*molesto/i,
  /pregunta.*identidad|identidad.*pregunta/i,
  /dato.*contradictorio/i,
  /dos descuentos? seguidos?/i,
  /IVA.*sin.*factura/i,
  /repite.*pregunta.*(?:ya respondió|definitivamente respondida)/i,
  /datos del cliente incorrectos/i,
  /precio(?:.*más bajo|.*menor).*historial/i, // contradicts previous price
  /\d+ preguntas?.*(solo|un\b)/i, // more than 1 question (concrete count)
];

/**
 * Verifica si una razón de rechazo es legítima (corresponde a una regla real).
 * Las razones subjetivas ("no es empático", "no responde bien") deben ignorarse.
 */
function esRechazoValido(razon) {
  return PATRONES_RECHAZO_VALIDO.some(p => p.test(razon));
}

/**
 * Pre-valida el mensaje con lógica determinista antes de llamar al LLM.
 * Retorna null si no hay pre-veredicto, o { decision, ... } si podemos decidir sin LLM.
 */
function preValidarMensaje(mensajePropuesto, instruccionOriginal, numPalabras, numEmojis) {
  const esPrimerContacto = instruccionOriginal && instruccionOriginal.toLowerCase().includes("primer contacto proactivo");
  if (esPrimerContacto) return null; // templates siempre pasan al LLM con excepción especial

  // Conteo de signos ? de cierre
  const numPreguntas = contarPreguntasCierre(mensajePropuesto);

  // Razón de rechazo inmediata por formato (determinista)
  if (numPalabras >= 39) {
    return {
      decision: "RECHAZA",
      razones: [`conteo_palabras_exacto es ${numPalabras}, supera el máximo de 38 para corrección automática`],
      correcciones_sugeridas: `Reescribir con máximo 30 palabras. Dejar solo: frase clave + 1 pregunta en negrita.`,
      mensaje_final: null,
    };
  }
  if (numPreguntas > 1) {
    return {
      decision: "RECHAZA",
      razones: [`El mensaje tiene ${numPreguntas} signos de cierre de pregunta (?). Solo se permite 1.`],
      correcciones_sugeridas: `Eliminar las preguntas extra. Dejar solo 1 pregunta al final, en negrita.`,
      mensaje_final: null,
    };
  }

  // Pre-aprobación determinista: mensaje niega servicio fuera de catálogo
  const nieganServicio = /no\s+(lo|los|la|las)?\s*(manejamos|ofrecemos|hacemos|tenemos|contamos con|incluimos)\b/i;
  const servicioFuera = /\b(dj|mesero[sa]?|catering|comida|bebida|mobiliario|decor[ao]|fotograf(?:ía|ia) (?:del evento|pro)|hora\s*loca|animador|payaso)\b/i;
  if (servicioFuera.test(mensajePropuesto) && nieganServicio.test(mensajePropuesto)) {
    // Mensaje NIEGA el servicio fuera de catálogo → marcar como "niega_servicio_fuera_catalogo"
    // No podemos auto-aprobar completamente (puede tener otros problemas), pero agregamos nota al contexto
    return null; // deja que el LLM lo revise, pero con nota en el user prompt
  }

  return null; // sin pre-veredicto, pasa al LLM
}

async function revisarMensaje(mensajePropuesto, contexto, historial, instruccionOriginal) {
  const numPalabras = contarPalabras(mensajePropuesto);
  const numEmojis = contarEmojis(mensajePropuesto);
  const numPreguntas = contarPreguntasCierre(mensajePropuesto);

  // Intento de veredicto determinista antes de llamar al LLM
  const preVeredicto = preValidarMensaje(mensajePropuesto, instruccionOriginal, numPalabras, numEmojis);
  if (preVeredicto) return preVeredicto;

  // Nota especial cuando el mensaje claramente NIEGA un servicio fuera de catálogo
  const nieganServicio = /no\s+(lo|los|la|las)?\s*(manejamos|ofrecemos|hacemos|tenemos|contamos con|incluimos)\b/i;
  const servicioFuera = /\b(dj|mesero[sa]?|catering|comida|bebida|mobiliario|decor[ao]|fotograf(?:ía|ia) (?:del evento|pro)|hora\s*loca|animador|payaso)\b/i;
  const notaNiega = (servicioFuera.test(mensajePropuesto) && nieganServicio.test(mensajePropuesto))
    ? "\n\n⚠️ NOTA AUTOMÁTICA: Este mensaje contiene una NEGACIÓN de servicio fuera de catálogo (dice 'no manejamos/ofrecemos'). Esto es CORRECTO. NO rechaces por 'ofrece servicio fuera de catálogo' — el bot está ACLARANDO que no lo ofrece."
    : "";

  const user = JSON.stringify({
    mensaje_propuesto: mensajePropuesto,
    conteo_palabras_exacto: numPalabras,
    conteo_emojis_exacto: numEmojis,
    conteo_preguntas_cierre: numPreguntas,
    contexto_lead: contexto,
    historial_reciente: (historial || []).slice(-5).map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
    etapa: contexto.etapa_actual,
    instruccion_original: instruccionOriginal,
  }, null, 2) + notaNiega;

  const resultado = await llamarJSONMini(PROMPT, user, { temperature: 0.1, maxTokens: 512 });

  // Post-filtro: si RECHAZA, validar que las razones sean legítimas
  if (resultado.decision === "RECHAZA") {
    const razones = resultado.razones || [];
    const razonesValidas = razones.filter(esRechazoValido);

    if (razonesValidas.length === 0) {
      // Todas las razones son inválidas (subjetivas/hallucinated) → APROBAR
      console.log(`[QA] ⚠️ Rechazo por razones inválidas, auto-aprobando. Razones filtradas: ${JSON.stringify(razones)}`);
      return {
        decision: "APRUEBA",
        mensaje_final: mensajePropuesto,
        nota: `Auto-aprobado: QA rechazó por razones no válidas (${razones.join("; ")})`,
      };
    }

    // Algunas razones válidas → rechazar con SOLO las válidas
    if (razonesValidas.length < razones.length) {
      const filtradas = razones.filter(r => !esRechazoValido(r));
      console.log(`[QA] ⚠️ Filtrando razones inválidas: ${JSON.stringify(filtradas)}`);
      resultado.razones = razonesValidas;
    }
  }

  return resultado;
}

module.exports = { revisarMensaje };
