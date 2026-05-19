/**
 * Test de 5 escenarios CRÍTICOS del nuevo prompt v2
 * Valida: paquete boda/quince, cobertura 2h, presupuesto, factura
 */
require("dotenv").config({ path: __dirname + "/../.env" });
const { generarMensaje } = require("../agentes/agentes_etapa");
const { revisarMensaje } = require("../agentes/agente_qa");
const { evaluarLead } = require("../agentes/supervisor");

const MAX_QA = 3;

const ESCENARIOS = [
  {
    n: 1,
    nombre: "Boda en Quito → paquete completo $320",
    cliente: "Hola, info para una boda",
    etapa: "contacto_inicial",
    num_seg: 1, // ya no es primer contacto, está conversando
    historial: [
      { role: "lead", content: "Hola, necesito info" },
      { role: "bot", content: "¡Hola! Somos *360 Eventos* 👋. ¿Qué tipo de evento estás organizando y para cuándo? 🗓️" },
    ],
    tipo_evento: "boda",
    espera_palabras: ["paquete", "320", "boda"],
    espera_no_contiene: ["DJ", "meseros"],
  },
  {
    n: 2,
    nombre: "Boda en Latacunga (provincia 2h) → paquete $320 también aplica",
    cliente: "Es una boda en Latacunga",
    etapa: "contacto_inicial",
    num_seg: 1,
    historial: [
      { role: "lead", content: "Hola, info" },
      { role: "bot", content: "¡Hola! Somos *360 Eventos* 👋. ¿Qué tipo de evento estás organizando y para cuándo? 🗓️" },
    ],
    tipo_evento: "boda",
    lugar: "Latacunga",
    espera_palabras: ["320", "Latacunga"],
    espera_no_contiene: ["fuera de cobertura", "no llegamos"],
  },
  {
    n: 3,
    nombre: "Boda en Cuenca (fuera de 2h) → bot rechaza + cierra lead",
    cliente: "Necesito 360 para una boda en Cuenca",
    etapa: "contacto_inicial",
    num_seg: 0,
    historial: [],
    tipo_evento: "boda",
    lugar: "Cuenca",
    espera_decision: "perdido",
    espera_palabras_msg: ["Cuenca", "2 horas"],
  },
  {
    n: 4,
    nombre: "Objeción de precio → bot debe preguntar presupuesto",
    cliente: "Está muy caro $320",
    etapa: "negociacion",
    num_seg: 2,
    historial: [
      { role: "lead", content: "Es una boda el 22 de noviembre" },
      { role: "bot", content: "¡Felicidades! Para tu boda te recomiendo el *Paquete Boda Completo*: ✅ 1h VideoBooth 360 ✅ 1h PhotoBooth ✅ Niebla + 2 pirotecnia. *Total: $320* (ahorras $40). *¿Para qué fecha?*" },
      { role: "lead", content: "Está caro" },
    ],
    tipo_evento: "boda",
    precio_cotizado: 320,
    nivel_negociacion: 0,
    espera_palabras: ["presupuesto"],
    espera_no_contiene: ["30 minutos", "ajustar $10"],
  },
  {
    n: 5,
    nombre: "Cliente pide factura → bot debe recalcular con IVA y pedir datos fiscales",
    cliente: "Sí, lo aseguro. Necesito factura",
    etapa: "seguimiento",
    num_seg: 2,
    historial: [
      { role: "lead", content: "Info para boda" },
      { role: "bot", content: "Te recomiendo el paquete completo: 1h video + 1h foto + niebla + 2 pirotecnia. Total *$320*. *¿Para qué fecha?*" },
      { role: "lead", content: "El 22 de noviembre" },
      { role: "bot", content: "¡Anotado! Paquete $320 para el 22 de noviembre. *¿Lo aseguramos?*" },
    ],
    tipo_evento: "boda",
    precio_cotizado: 320,
    requiere_factura: true,
    espera_palabras: ["RUC", "$368", "razón social"],
    espera_no_contiene: ["Erika"],
  },
];

async function correrEscenario(esc) {
  const contexto = {
    lead_id: 80000 + esc.n,
    nombre: "Test",
    etapa_actual: esc.etapa,
    ultimo_mensaje_cliente: esc.cliente,
    conversacion: {
      ultimo_mensaje_cliente: esc.cliente,
      num_seguimientos_enviados: esc.num_seg,
      tono_cliente: esc.tono_cliente || "interesado",
      ultimo_mensaje_bot: esc.historial.filter(m => m.role !== "lead").pop()?.content || "",
    },
    datos_evento: {
      tipo: esc.tipo_evento || null,
      fecha: null,
      lugar: esc.lugar || null,
      duracion_horas: null,
      num_invitados: null,
      servicio_interes: null,
      requiere_factura: esc.requiere_factura || null,
    },
    comercial: {
      precio_cotizado: esc.precio_cotizado || null,
      nivel_negociacion_actual: esc.nivel_negociacion ?? 0,
    },
    alertas: esc.alertas || [],
    tono_cliente: esc.tono_cliente || "interesado",
    nivel_negociacion: esc.nivel_negociacion ?? 0,
    resumen_conversacion: `Cliente: "${esc.cliente}". Lugar: ${esc.lugar || "no especificado"}`,
  };
  const lead = {
    id: contexto.lead_id, nombre: "Test", telefono: "593XXXXXXXXX",
    etapa_actual: esc.etapa, contexto,
    tiempo_sin_respuesta_horas: 0,
    historial: [...esc.historial, { role: "lead", content: esc.cliente, timestamp: new Date().toISOString() }],
  };

  let decision;
  try {
    decision = await evaluarLead(lead);
  } catch (e) {
    return { error: "supervisor: " + e.message };
  }

  // Verificar decisión específica si se espera
  if (esc.espera_decision === "perdido") {
    const movido = decision.nueva_etapa === "perdido";
    if (decision.agente_destino === "humano" || decision.accion === "esperar") {
      return { ok: false, error: "se esperaba responder + cerrar lead, no escalar" };
    }
    // Sigue al QA loop para validar el mensaje
  }

  if (decision.agente_destino === "humano" || decision.accion === "escalar") {
    return {
      supervisor_decision: decision.accion + " → " + decision.agente_destino,
      razon: decision.razon_decision,
      mensaje_final: "(ESCALADO A HUMANO)",
      qa_intentos: 0,
      ok: !esc.espera_palabras, // si esperábamos palabras → falla
    };
  }
  if (decision.accion === "esperar") {
    return {
      supervisor_decision: "esperar",
      razon: decision.razon_decision,
      mensaje_final: "(NO ENVÍA NADA)",
      qa_intentos: 0,
      ok: false,
    };
  }

  let mensajeFinal = null;
  let intentos = 0;
  let ultimaCorreccion = null;
  let razonesQA = [];

  while (intentos < MAX_QA && !mensajeFinal) {
    intentos++;
    const instr = ultimaCorreccion
      ? `${decision.instruccion_agente}\n\nCORRECCIÓN QA (intento ${intentos}): ${ultimaCorreccion}`
      : decision.instruccion_agente;
    const borrador = await generarMensaje(decision.agente_destino, contexto, instr, lead.historial);
    const revision = await revisarMensaje(borrador, contexto, lead.historial, decision.instruccion_agente);
    if (revision.decision === "APRUEBA") {
      mensajeFinal = revision.mensaje_final;
    } else {
      ultimaCorreccion = revision.correcciones_sugeridas || revision.razones?.join("; ") || "";
      razonesQA.push({ intento: intentos, razones: revision.razones, borrador: borrador.substring(0, 150) });
    }
  }

  // Validar palabras esperadas / no esperadas
  let ok = !!mensajeFinal;
  const errores = [];
  if (mensajeFinal) {
    const msgLower = mensajeFinal.toLowerCase();
    const palabras = esc.espera_palabras || esc.espera_palabras_msg || [];
    for (const palabra of palabras) {
      if (!msgLower.includes(palabra.toLowerCase())) {
        errores.push(`falta palabra clave: "${palabra}"`);
        ok = false;
      }
    }
    for (const palabra of (esc.espera_no_contiene || [])) {
      if (msgLower.includes(palabra.toLowerCase())) {
        errores.push(`contiene palabra prohibida: "${palabra}"`);
        ok = false;
      }
    }
  }

  return {
    supervisor_decision: decision.accion + " → " + decision.agente_destino,
    nueva_etapa: decision.nueva_etapa,
    instruccion: decision.instruccion_agente?.substring(0, 200),
    qa_intentos: intentos,
    mensaje_final: mensajeFinal || "(FALLBACK — QA rechazó 3x)",
    razonesQA,
    errores,
    ok,
  };
}

(async () => {
  console.log("═".repeat(80));
  console.log("  TEST 5 ESCENARIOS — Prompt v2 (paquete, cobertura, presupuesto, factura)");
  console.log("═".repeat(80));

  const resultados = [];
  for (const esc of ESCENARIOS) {
    console.log(`\n${"─".repeat(80)}`);
    console.log(`[${esc.n}] ${esc.nombre}`);
    console.log(`Cliente: "${esc.cliente}"`);
    const r = await correrEscenario(esc);
    if (r.error) {
      console.log(`❌ ERROR: ${r.error}`);
      resultados.push({ n: esc.n, ok: false, err: r.error });
      continue;
    }
    console.log(`Supervisor → ${r.supervisor_decision}${r.nueva_etapa ? " | nueva_etapa: " + r.nueva_etapa : ""}`);
    if (r.instruccion) console.log(`Instrucción: ${r.instruccion}`);
    console.log(`QA: ${r.qa_intentos} intento${r.qa_intentos !== 1 ? "s" : ""}`);
    if (r.razonesQA?.length) {
      for (const rz of r.razonesQA) console.log(`  ✗ intento ${rz.intento}: ${JSON.stringify(rz.razones)}`);
    }
    console.log(`MENSAJE FINAL:\n  ${(r.mensaje_final || "").substring(0, 500).replace(/\n/g, "\n  ")}`);
    if (r.errores?.length) {
      console.log(`❌ Errores de validación:`);
      r.errores.forEach(e => console.log(`  - ${e}`));
    }
    console.log(r.ok ? "✅ PASS" : "❌ FAIL");
    resultados.push({ n: esc.n, ok: r.ok, mensaje: r.mensaje_final, errores: r.errores });
  }

  console.log("\n" + "═".repeat(80));
  console.log("  RESUMEN");
  console.log("═".repeat(80));
  const pass = resultados.filter(r => r.ok).length;
  console.log(`✅ Pass: ${pass}/${resultados.length}`);
  console.log(`❌ Fail: ${resultados.length - pass}/${resultados.length}`);
  if (pass < resultados.length) {
    console.log("\nFallos:");
    resultados.filter(r => !r.ok).forEach(r => console.log(`  [${r.n}] ${r.err || JSON.stringify(r.errores)}`));
  }
  process.exit(pass === resultados.length ? 0 : 1);
})().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
