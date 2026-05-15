/**
 * Test de 10 escenarios diversos del bot 360 Eventos
 * Corre el flujo completo en seco (sin enviar mensajes reales)
 */
require("dotenv").config({ path: __dirname + "/../.env" });
const { generarMensaje } = require("../agentes/agentes_etapa");
const { revisarMensaje } = require("../agentes/agente_qa");
const { evaluarLead } = require("../agentes/supervisor");
const { validarMensajeFinal } = (() => {
  // validarMensajeFinal está dentro de ciclo_supervisor.js, lo extraemos
  // copiando la función inline si no está exportada.
  try { return require("../agentes/ciclo_supervisor"); } catch { return { validarMensajeFinal: null }; }
})();

const MAX_QA = 3;

const ESCENARIOS = [
  {
    n: 1,
    nombre: "Primer contacto — info vaga",
    cliente: "Hola necesito información",
    etapa: "contacto_inicial",
    num_seg: 0,
    historial: [],
    espera: "TEMPLATE GENERAL",
  },
  {
    n: 2,
    nombre: "Primer contacto — 360 explícito boda",
    cliente: "Hola, me interesa el videobooth 360 para mi boda",
    etapa: "contacto_inicial",
    num_seg: 0,
    historial: [],
    tipo_evento: "boda",
    espera: "TEMPLATE 360",
  },
  {
    n: 3,
    nombre: "Primer contacto — photobooth para quinceaños",
    cliente: "Buenos días, busco photobooth para 200 personas en quinceaños",
    etapa: "contacto_inicial",
    num_seg: 0,
    historial: [],
    tipo_evento: "quinceanos",
    espera: "TEMPLATE PHOTOBOOTH",
  },
  {
    n: 4,
    nombre: "Primer contacto — niebla+pirotecnia para vals",
    cliente: "Hola, quiero niebla y pirotecnia para el vals de mi boda",
    etapa: "contacto_inicial",
    num_seg: 0,
    historial: [],
    tipo_evento: "boda",
    espera: "TEMPLATE NIEBLA_PIROTECNIA",
  },
  {
    n: 5,
    nombre: "Lead con info completa desde el inicio",
    cliente: "Hola, necesito 360 para mi boda el 15 de junio 2026 en Quito, 150 invitados",
    etapa: "contacto_inicial",
    num_seg: 0,
    historial: [],
    tipo_evento: "boda",
    espera: "Template 360 o cotización 2-3h",
  },
  {
    n: 6,
    nombre: "Objeción de precio (negociación nivel 1)",
    cliente: "Está muy caro 210 dólares por 2 horas",
    etapa: "negociacion",
    num_seg: 1,
    historial: [
      { role: "lead", content: "Hola, info del 360 para boda" },
      { role: "bot", content: "¡Hola! Para tu boda el 360 queda perfecto. 2 horas a $210. **¿Te ajusta el valor?**" },
    ],
    tipo_evento: "boda",
    precio_cotizado: 210,
    espera: "Refuerzo de valor, NO bajar precio (escalera nivel 1)",
  },
  {
    n: 7,
    nombre: "Dato contradictorio en fecha",
    cliente: "Es el 15 de junio... o no, el 22 mejor",
    etapa: "contacto_inicial",
    num_seg: 1,
    historial: [
      { role: "lead", content: "Hola info del 360" },
      { role: "bot", content: "¡Hola! Para tu evento queda genial. **¿Para qué fecha sería?**" },
    ],
    espera: "Pedir confirmación de fecha sin avanzar",
  },
  {
    n: 8,
    nombre: "Pide servicio fuera de catálogo (DJ)",
    cliente: "Perfecto, también necesito DJ y meseros para ese día",
    etapa: "seguimiento",
    num_seg: 2,
    historial: [
      { role: "lead", content: "Info del 360 para boda" },
      { role: "bot", content: "¡Hola! Para tu boda el 360 genera videos virales. **¿Para qué fecha?**" },
      { role: "lead", content: "15 de junio" },
      { role: "bot", content: "Perfecto, queda disponible. 2h del 360 a $210. **¿Te conviene?**" },
    ],
    tipo_evento: "boda",
    precio_cotizado: 210,
    espera: "Aclarar que NO ofrecemos DJ/meseros, redirigir al 360",
  },
  {
    n: 9,
    nombre: "Cliente molesto (escalado)",
    cliente: "Ya me escribieron varias veces, no insistan más",
    etapa: "seguimiento",
    num_seg: 3,
    historial: [
      { role: "bot", content: "Hola, info del 360" },
      { role: "bot", content: "Hola, sigues interesado?" },
      { role: "bot", content: "Hola, qué piensas?" },
    ],
    tono_cliente: "molesto",
    alertas: ["cliente_molesto"],
    espera: "Escalar a humano, no enviar mensaje",
  },
  {
    n: 10,
    nombre: "Cliente pregunta si es bot",
    cliente: "Eres una persona real o un bot?",
    etapa: "contacto_inicial",
    num_seg: 1,
    historial: [
      { role: "bot", content: "¡Hola! Somos *360 Eventos*. **¿Tu evento?**" },
    ],
    alertas: ["pregunta_identidad"],
    espera: "Escalar a humano (política)",
  },
];

async function correrEscenario(esc) {
  const contexto = {
    lead_id: 90000 + esc.n,
    nombre: "Test",
    etapa_actual: esc.etapa,
    ultimo_mensaje_cliente: esc.cliente,
    conversacion: {
      ultimo_mensaje_cliente: esc.cliente,
      num_seguimientos_enviados: esc.num_seg,
      tono_cliente: esc.tono_cliente || "interesado",
      ultimo_mensaje_bot: esc.historial.filter(m => m.role !== "lead").pop()?.content || "",
    },
    datos_evento: { tipo: esc.tipo_evento || null, fecha: null, lugar: null, duracion_horas: null, num_invitados: null, servicio_interes: null, requiere_factura: null },
    comercial: { precio_cotizado: esc.precio_cotizado || null, nivel_negociacion_actual: 0 },
    alertas: esc.alertas || [],
    tono_cliente: esc.tono_cliente || "interesado",
    resumen_conversacion: `Cliente escribió: "${esc.cliente}"`,
  };
  const lead = {
    id: contexto.lead_id, nombre: "Test", telefono: "593XXXXXXXXX",
    etapa_actual: esc.etapa, contexto,
    tiempo_sin_respuesta_horas: 0,
    historial: [...esc.historial, { role: "lead", content: esc.cliente, timestamp: new Date().toISOString() }],
  };

  // Supervisor
  let decision;
  try {
    decision = await evaluarLead(lead);
  } catch (e) {
    return { error: "supervisor: " + e.message };
  }

  // Si supervisor escala → no procesa más
  if (decision.agente_destino === "humano" || decision.accion === "escalar") {
    return {
      supervisor_decision: decision.accion + " → " + decision.agente_destino,
      razon: decision.razon_decision,
      mensaje_final: "(ESCALADO A HUMANO — no envía mensaje)",
      qa_intentos: 0,
      ok: true,
    };
  }
  if (decision.accion === "esperar") {
    return {
      supervisor_decision: "esperar",
      razon: decision.razon_decision,
      mensaje_final: "(NO ENVÍA NADA — esperar)",
      qa_intentos: 0,
      ok: true,
    };
  }

  // Loop QA (3 retries como en producción)
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
      razonesQA.push({ intento: intentos, razones: revision.razones, borrador: borrador.substring(0, 100) });
    }
  }

  return {
    supervisor_decision: decision.accion + " → " + decision.agente_destino,
    instruccion: decision.instruccion_agente?.substring(0, 100),
    qa_intentos: intentos,
    mensaje_final: mensajeFinal || "(FALLBACK GENÉRICO — QA rechazó 3x)",
    razonesQA,
    ok: !!mensajeFinal,
  };
}

(async () => {
  console.log("═".repeat(80));
  console.log("  TEST 10 ESCENARIOS — Bot 360 Eventos");
  console.log("═".repeat(80));

  const resultados = [];
  for (const esc of ESCENARIOS) {
    console.log(`\n${"─".repeat(80)}`);
    console.log(`[${esc.n}] ${esc.nombre}`);
    console.log(`Cliente: "${esc.cliente}"`);
    console.log(`Espera:  ${esc.espera}`);
    const r = await correrEscenario(esc);
    if (r.error) {
      console.log(`❌ ERROR: ${r.error}`);
      resultados.push({ n: esc.n, ok: false, err: r.error });
      continue;
    }
    console.log(`Supervisor → ${r.supervisor_decision}`);
    if (r.instruccion) console.log(`Instrucción: ${r.instruccion}`);
    console.log(`QA: ${r.qa_intentos} intento${r.qa_intentos !== 1 ? "s" : ""}`);
    if (r.razonesQA?.length) {
      for (const rz of r.razonesQA) console.log(`  ✗ intento ${rz.intento}: ${JSON.stringify(rz.razones)}`);
    }
    console.log(`MENSAJE FINAL:\n  ${(r.mensaje_final || "").substring(0, 400).replace(/\n/g, "\n  ")}`);
    resultados.push({ n: esc.n, ok: r.ok, esperado: esc.espera, mensaje: r.mensaje_final });
  }

  console.log(`\n${"═".repeat(80)}`);
  console.log("  RESUMEN");
  console.log("═".repeat(80));
  const ok = resultados.filter(r => r.ok).length;
  console.log(`✓ ${ok}/10 escenarios manejados sin caer al fallback genérico`);
  console.log(`✗ ${10 - ok}/10 cayeron al fallback`);
})().catch(e => console.error("FATAL:", e.message));
