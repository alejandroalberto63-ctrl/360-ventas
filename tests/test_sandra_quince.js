/**
 * Test del caso Sandra (lead 21318225):
 * Cliente recibió TEMPLATE GENERAL y respondió "Quinceaños" — el bot debe
 * activar el paquete $320 inmediatamente (no volver a preguntar tipo de evento).
 *
 * Este test simula el ciclo completo SIN tocar producción. Verifica el override
 * determinista de boda/quinceaños en ciclo_supervisor.js.
 */
require("dotenv").config({ path: __dirname + "/../.env" });
const { generarMensaje } = require("../agentes/agentes_etapa");
const { revisarMensaje } = require("../agentes/agente_qa");
const { evaluarLead } = require("../agentes/supervisor");

// Importamos la lógica de override directamente (replicada del ciclo_supervisor)
function aplicarOverridePaquete(accion, lead) {
  const ultMsg = (lead.contexto?.ultimo_mensaje_cliente || "").toLowerCase();
  const historialReciente = (lead.historial || [])
    .filter((m) => m.role === "lead")
    .slice(-3)
    .map((m) => (m.content || "").toLowerCase())
    .join(" ");
  const logWaLower = (lead.log_wa || "").toLowerCase();
  const textoBusqueda = `${ultMsg} ${historialReciente}`;

  const detectaBoda = /\b(boda|casamiento|matrimonio|me caso)\b/.test(textoBusqueda);
  const detectaQuince = /\b(quincea(?:ñ|n)os?|quincea(?:ñ|n)era|15 a(?:ñ|n)os|de los 15)\b/.test(textoBusqueda);

  const precioYaCotizado = !!(lead.contexto?.comercial?.precio_cotizado);
  const yaSeOfrecioPaquete = /paquete (boda|quincea(?:ñ|n)os) completo|paquete.*\$320|paquete.*\$300/i.test(logWaLower);
  const clienteRechazoPaquete = /\b(solo|nada m[aá]s|únicamente)\s+(el\s+)?(360|video(?:booth)?|photo(?:booth)?|fotos?|niebla|pirotecnia)\b/.test(historialReciente);

  const supervisorQuiereCerrar =
    accion.nueva_etapa === "perdido" ||
    (accion.instruccion_agente || "").toLowerCase().includes("fuera de cobertura");

  const aplicaPaquete = (detectaBoda || detectaQuince)
    && !precioYaCotizado
    && !yaSeOfrecioPaquete
    && !clienteRechazoPaquete
    && !supervisorQuiereCerrar
    && accion.agente_destino !== "humano"
    && accion.accion !== "esperar";

  if (aplicaPaquete) {
    const esBoda = detectaBoda;
    const tipoLabel = esBoda ? "boda" : "quinceaños";
    const tipoTitulo = esBoda ? "Boda" : "Quinceaños";
    const emoji = esBoda ? "💍" : "👑";
    const felicitacion = esBoda ? "¡Felicidades por tu boda" : "¡Qué bueno, los 15 años";

    const provincias = ["latacunga","otavalo","ibarra","cayambe","cotacachi","tabacundo","machachi","salcedo","mindo","papallacta","baeza","los bancos","nanegalito","aloag"];
    let lugarDetectado = null;
    for (const p of provincias) {
      if (textoBusqueda.includes(p)) {
        lugarDetectado = p.split(" ").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
        break;
      }
    }
    const lugarSaludo = lugarDetectado ? ` en ${lugarDetectado}` : "";
    const lugarLinea = lugarDetectado ? `\n🚐 *Cobertura ${lugarDetectado} incluida*` : "";

    const detectaFecha = /\b\d{1,2}\s*(de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b|\b\d{1,2}[\/\-]\d{1,2}[\/\-]?\d{0,4}\b/i.test(textoBusqueda);
    const preguntaFinal = detectaFecha ? "*¿Lo aseguramos?*" : "*¿Para qué fecha es?*";

    accion.instruccion_agente = `OVERRIDE DETERMINISTA — Cliente confirmó ${tipoLabel}${lugarDetectado ? ` en ${lugarDetectado}` : ""}. Genera EXACTAMENTE este mensaje (copia palabra por palabra, no improvises, no simplifiques, no preguntes por tipo de evento — el cliente ya lo dijo):

${felicitacion}${lugarSaludo} ${emoji}! Te recomiendo el *Paquete ${tipoTitulo} Completo*:
✅ *1h VideoBooth 360*
✅ *1h PhotoBooth*
✅ *Niebla baja + 2 pirotecnia frías*${lugarLinea}

***Total: $320*** *(ahorras $40 vs separado)*

${preguntaFinal}`;
    return { aplicado: true, tipo: tipoLabel, lugar: lugarDetectado, fecha: detectaFecha };
  }
  return { aplicado: false };
}

const ESCENARIOS = [
  {
    n: 1,
    nombre: "Sandra Turn 3 — responde solo 'Quinceaños'",
    cliente: "Quinceaños",
    etapa: "contacto_inicial",
    num_seg: 1,
    historial: [
      { role: "lead", content: "¡Hola! Quiero más información" },
      { role: "bot", content: "¡Hola! Somos *360 Eventos* 👋... ¿Qué tipo de evento estás organizando y para cuándo?" },
    ],
    espera_palabras: ["Paquete Quinceaños", "320", "1h VideoBooth", "fecha"],
    espera_no_contiene: ["¿es boda, quinceaños, cumple", "qué tipo de evento", "tipo de evento estás"],
  },
  {
    n: 2,
    nombre: "Sandra Turn 5 — '27 de junio quinceaños' (tipo + fecha en mismo msg)",
    cliente: "27 de junio quinceaños",
    etapa: "seguimiento",
    num_seg: 2,
    historial: [
      { role: "lead", content: "Quiero más información" },
      { role: "bot", content: "¡Hola! Somos *360 Eventos*..." },
      { role: "lead", content: "Quinceaños" },
      { role: "bot", content: "Claro 🙌 Para darte el precio exacto necesito saber: ¿es boda, quinceaños, cumple o corporativo?" },
    ],
    espera_palabras: ["Paquete Quinceaños", "320", "aseguramos"],
    espera_no_contiene: ["¿es boda, quinceaños, cumple", "Las fechas para eventos se están llenando"],
  },
  {
    n: 3,
    nombre: "Boda con fecha en mismo mensaje",
    cliente: "Boda el 15 de junio",
    etapa: "contacto_inicial",
    num_seg: 1,
    historial: [
      { role: "lead", content: "Hola necesito info" },
      { role: "bot", content: "¡Hola! Somos *360 Eventos*..." },
    ],
    espera_palabras: ["Paquete Boda", "320", "💍", "aseguramos"],
    espera_no_contiene: ["qué tipo de evento", "boda, quinceaños, cumple"],
  },
  {
    n: 4,
    nombre: "Boda en Latacunga (provincia)",
    cliente: "Es una boda en Latacunga",
    etapa: "contacto_inicial",
    num_seg: 1,
    historial: [
      { role: "lead", content: "Hola info" },
      { role: "bot", content: "TEMPLATE GENERAL..." },
    ],
    espera_palabras: ["Latacunga", "320", "Cobertura"],
    espera_no_contiene: ["fuera de cobertura", "no llegamos"],
  },
  {
    n: 5,
    nombre: "Cliente ya RECHAZÓ paquete — solo quiere 360 (override NO debe aplicar)",
    cliente: "Solo el video 360 entonces",
    etapa: "seguimiento",
    num_seg: 3,
    historial: [
      { role: "lead", content: "Es una boda" },
      { role: "bot", content: "¡Felicidades por tu boda 💍! Paquete Boda Completo $320..." },
      { role: "lead", content: "Solo el video 360 entonces" },
    ],
    espera_no_aplica_override: true, // NO debe forzar paquete porque ya lo rechazó
  },
];

async function correrEscenario(esc) {
  const contexto = {
    lead_id: 70000 + esc.n,
    nombre: "Test Sandra",
    etapa_actual: esc.etapa,
    ultimo_mensaje_cliente: esc.cliente,
    conversacion: {
      ultimo_mensaje_cliente: esc.cliente,
      num_seguimientos_enviados: esc.num_seg,
      tono_cliente: "interesado",
      ultimo_mensaje_bot: esc.historial.filter(m => m.role !== "lead").pop()?.content || "",
    },
    datos_evento: { tipo: null, fecha: null, lugar: null },
    comercial: { precio_cotizado: null, nivel_negociacion_actual: 0 },
    alertas: [],
    tono_cliente: "interesado",
    nivel_negociacion: 0,
    resumen_conversacion: `Cliente: "${esc.cliente}"`,
  };
  const lead = {
    id: contexto.lead_id, nombre: "Test", telefono: "593XXXXXXXXX",
    etapa_actual: esc.etapa, contexto,
    historial: [...esc.historial, { role: "lead", content: esc.cliente, timestamp: new Date().toISOString() }],
    log_wa: "",
  };

  // Simulamos la decisión del supervisor (genérica)
  const accion = {
    accion: "responder",
    agente_destino: esc.etapa === "seguimiento" ? "seguimiento" : "contacto_inicial",
    instruccion_agente: "Continuar conversación con el cliente.", // genérica — el override la sobrescribe
    nueva_etapa: null,
  };

  // Aplicar override (lógica replicada del ciclo_supervisor)
  const overrideResult = aplicarOverridePaquete(accion, lead);

  if (esc.espera_no_aplica_override) {
    return {
      override_aplicado: overrideResult.aplicado,
      mensaje_final: overrideResult.aplicado ? "(override aplicado — INCORRECTO)" : "(override NO aplicado — correcto)",
      ok: !overrideResult.aplicado,
      errores: overrideResult.aplicado ? ["override aplicó cuando no debía"] : [],
    };
  }

  if (!overrideResult.aplicado) {
    return {
      override_aplicado: false,
      ok: false,
      errores: ["override NO aplicó cuando debía detectar " + esc.cliente],
    };
  }

  // Generar mensaje con el agente
  const borrador = await generarMensaje(accion.agente_destino, contexto, accion.instruccion_agente, lead.historial);

  // Validar palabras
  let ok = true;
  const errores = [];
  const lowerMsg = borrador.toLowerCase();
  for (const palabra of (esc.espera_palabras || [])) {
    if (!lowerMsg.includes(palabra.toLowerCase())) {
      errores.push(`falta: "${palabra}"`);
      ok = false;
    }
  }
  for (const palabra of (esc.espera_no_contiene || [])) {
    if (lowerMsg.includes(palabra.toLowerCase())) {
      errores.push(`contiene prohibida: "${palabra}"`);
      ok = false;
    }
  }

  return {
    override_aplicado: true,
    override_info: overrideResult,
    mensaje_final: borrador,
    errores,
    ok,
  };
}

(async () => {
  console.log("═".repeat(80));
  console.log("  TEST CASO SANDRA — Override determinista boda/quinceaños");
  console.log("═".repeat(80));

  const resultados = [];
  for (const esc of ESCENARIOS) {
    console.log(`\n${"─".repeat(80)}`);
    console.log(`[${esc.n}] ${esc.nombre}`);
    console.log(`Cliente: "${esc.cliente}"`);
    const r = await correrEscenario(esc);
    console.log(`Override aplicado: ${r.override_aplicado}`);
    if (r.override_info) console.log(`Override info:`, JSON.stringify(r.override_info));
    console.log(`MENSAJE:`);
    console.log("  " + (r.mensaje_final || "").substring(0, 500).replace(/\n/g, "\n  "));
    if (r.errores?.length) {
      console.log(`❌ Errores:`);
      r.errores.forEach(e => console.log(`  - ${e}`));
    }
    console.log(r.ok ? "✅ PASS" : "❌ FAIL");
    resultados.push({ n: esc.n, ok: r.ok, errores: r.errores });
  }

  console.log("\n" + "═".repeat(80));
  console.log("  RESUMEN");
  console.log("═".repeat(80));
  const pass = resultados.filter(r => r.ok).length;
  console.log(`✅ Pass: ${pass}/${resultados.length}`);
  console.log(`❌ Fail: ${resultados.length - pass}/${resultados.length}`);
  if (pass < resultados.length) {
    resultados.filter(r => !r.ok).forEach(r => console.log(`  [${r.n}] ${JSON.stringify(r.errores)}`));
  }
  process.exit(pass === resultados.length ? 0 : 1);
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
