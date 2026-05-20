const { llamarMini } = require("./openai_client");
const fs = require("fs");
const path = require("path");

const PROMPTS = {
  contacto_inicial: fs.readFileSync(path.join(__dirname, "../prompts/agente_ventas.md"), "utf8"),
  seguimiento:      fs.readFileSync(path.join(__dirname, "../prompts/agente_seguimiento.md"), "utf8"),
  negociacion:      fs.readFileSync(path.join(__dirname, "../prompts/agente_negociacion.md"), "utf8"),
  reserva:          fs.readFileSync(path.join(__dirname, "../prompts/agente_ventas.md"), "utf8"),
  // fallback
  nuevo:            fs.readFileSync(path.join(__dirname, "../prompts/agente_ventas.md"), "utf8"),
};

async function generarMensaje(etapa, contexto, instruccion, historial = []) {
  const prompt = PROMPTS[etapa] || PROMPTS.nuevo;

  const historialTexto = historial
    .slice(-6)
    .map((m) => `${m.role === "lead" ? "CLIENTE" : "BOT"}: ${m.content}`)
    .join("\n");

  // Detección DETERMINISTA de primer contacto: si el bot nunca ha enviado
  // un mensaje (num_seguimientos = 0 Y no hay [BOT→] en historial), es
  // primer contacto sin importar qué diga la instrucción del supervisor.
  // Esto previene que la inconsistencia del LLM supervisor (que a veces
  // decide "seguimiento" cuando debería ser "primer contacto") rompa el
  // flujo: el agente siempre va a copiar el template cuando corresponde.
  //
  // EXCEPCIÓN: si la instrucción menciona cerrar lead (fuera cobertura,
  // comprar equipo, etc.), NO forzar template — respetar al supervisor.
  const numSeg = contexto?.conversacion?.num_seguimientos_enviados ?? 0;
  const botEnvioAlgo = (historial || []).some((m) => m.role !== "lead");
  const instrLower = (instruccion || "").toLowerCase();
  const supervisorQuiereCerrar =
    instrLower.includes("fuera de cobertura") ||
    instrLower.includes("comprar el equipo") ||
    instrLower.includes("no vendemos") ||
    instrLower.includes("se cerrará tras este mensaje") ||
    instrLower.includes("lead se cierra");
  // EXCEPCIÓN: si la instrucción ya viene de un override determinista del
  // ciclo_supervisor (ej: paquete boda/quinceaños detectado), NO aplicar
  // primer contacto override aquí — la instrucción del supervisor manda.
  const yaHayOverride = instrLower.includes("override determinista");
  const esPrimerContactoDeterminista =
    etapa === "contacto_inicial" && numSeg === 0 && !botEnvioAlgo && !supervisorQuiereCerrar && !yaHayOverride;

  const esPrimerContacto =
    esPrimerContactoDeterminista ||
    instruccion.toLowerCase().includes("primer contacto proactivo");

  // Si es primer contacto pero la instrucción del supervisor no lo dice,
  // FORZAR la instrucción correcta para que el agente copie un template.
  // Detectamos qué template usar según el último mensaje del cliente.
  let instruccionFinal = instruccion;
  if (esPrimerContactoDeterminista && !instruccion.toLowerCase().includes("primer contacto proactivo")) {
    const ultMsg = (contexto?.ultimo_mensaje_cliente || contexto?.conversacion?.ultimo_mensaje_cliente || "").toLowerCase();
    let templateName = "GENERAL";
    if (/360|videobooth|video.?360|plataforma|slow.?motion|video/.test(ultMsg)) templateName = "360";
    else if (/photobooth|photo.?booth|fotos|fotograf|impresi/.test(ultMsg)) templateName = "PHOTOBOOTH";
    else if (/niebla|pirotecnia|fuegos|cartuchos|vals|efectos/.test(ultMsg)) templateName = "NIEBLA_PIROTECNIA";
    instruccionFinal = `Primer contacto proactivo — usa EXACTAMENTE el TEMPLATE ${templateName} del agente_ventas (sección PRIMER CONTACTO PROACTIVO). No improvises, no resumas, no cambies nada.`;
    console.log(`[Agente] 🔧 Override determinista: forzando primer contacto TEMPLATE ${templateName} (supervisor dijo otra cosa)`);
  }

  const user = `ETAPA: ${etapa.toUpperCase()}

CONTEXTO DEL LEAD:
${JSON.stringify(contexto, null, 2)}

HISTORIAL RECIENTE:
${historialTexto || "(primer contacto)"}

INSTRUCCIÓN DEL SUPERVISOR:
${instruccionFinal}

${esPrimerContacto
  ? `⚠️ INSTRUCCIÓN CRÍTICA: Copia el template indicado EXACTAMENTE, palabra por palabra, incluyendo emojis, saltos de línea y formato. El límite de 35 palabras NO aplica a templates de primer contacto. NO improvises, NO resumas, NO cambies nada.`
  : `⚠️ LÍMITES ESTRICTOS — el QA RECHAZA si los violas:
- MÁXIMO 35 PALABRAS (cuenta separando por espacios)
- MÁXIMO 2 ORACIONES (separadas por punto final)
- MÁXIMO 1 PREGUNTA — exactamente 1 solo signo "?" de cierre, al final, en **negrita**. El par ¿...? cuenta como 1 sola pregunta.
- Si la instrucción dice "UNA SOLA pregunta cerrada con dos opciones" → escribe EXACTAMENTE "**¿Opción A o Opción B?**" y nada más
- MÁXIMO 1 EMOJI en todo el mensaje (0 emojis es mejor)
- NO REPETIR preguntas que el cliente ya respondió en historial
- NO contradecir lo que el bot ya dijo antes

Si lead.nombre es tipo "Lead #12345" o "Lead", NO lo uses como nombre — di solo "Hola" sin nombre.

Ejemplo correcto con 22 palabras, 1 oración, 1 pregunta: "Para tu boda el 360 genera videos que los invitados se llevan al instante. **¿Para qué fecha sería?**"`
}

Genera SOLO el texto del mensaje. Sin comillas, sin explicaciones, sin prefijos.`;

  return llamarMini(prompt, user, { temperature: esPrimerContacto ? 0 : 0.75, maxTokens: esPrimerContacto ? 600 : 200 });
}

module.exports = { generarMensaje };
