/**
 * Test harness — 10 clientes para validar el pipeline de IA
 *
 * Prueba los agentes directamente sin Kommo ni Evolution API.
 * Requiere: OPENAI_API_KEY en .env
 *
 * Uso: node tests/test_10_clientes.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { extraerContexto } = require("../agentes/agente_contexto");
const { generarMensaje } = require("../agentes/agentes_etapa");
const { revisarMensaje } = require("../agentes/agente_qa");
const { evaluarEmbudo } = require("../agentes/supervisor");

// ─── Colores para consola ─────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  verde: "\x1b[32m",
  rojo: "\x1b[31m",
  amarillo: "\x1b[33m",
  cyan: "\x1b[36m",
  gris: "\x1b[90m",
  magenta: "\x1b[35m",
};

function log(color, prefix, msg) {
  console.log(`${color}${prefix}${C.reset} ${msg}`);
}

// ─── 10 Escenarios de prueba ──────────────────────────────────────────────────

const ESCENARIOS = [
  // ─── FÁCIL ───────────────────────────────────────────────────────────────
  {
    id: 1,
    nivel: "FÁCIL",
    descripcion: "Cliente interesado, primer contacto con precio",
    lead: {
      id: 1001, nombre: "Lead 360 593987654321",
      etapa_actual: "nuevo", etapaId: 68329664,
      tipo_evento: [], servicios_interes: [], pausar_ia: false,
      timestamp_creacion: Date.now() / 1000 - 300,
      timestamp_actualizacion: Date.now() / 1000 - 60,
    },
    historial: [
      { role: "lead", content: "Buenas tardes cuánto cuesta el fotobooth 360", timestamp: new Date(Date.now() - 5 * 60000).toISOString() }
    ],
    expectativas: ["Da precio del 360", "No más de 35 palabras", "Hace una pregunta", "No menciona todos los servicios"],
  },

  {
    id: 2,
    nivel: "FÁCIL",
    descripcion: "Cliente listo para reservar, solo necesita datos de pago",
    lead: {
      id: 1002, nombre: "María García",
      etapa_actual: "negociacion", etapaId: 68329672,
      tipo_evento: ["cumpleanos"], servicios_interes: ["videobooth_360"],
      pausar_ia: false,
      timestamp_creacion: Date.now() / 1000 - 86400,
      timestamp_actualizacion: Date.now() / 1000 - 1800,
    },
    historial: [
      { role: "bot", content: "Hola María, para 2 horas del 360 el valor es $210. ¿Te ajusta?", timestamp: new Date(Date.now() - 30 * 60000).toISOString() },
      { role: "lead", content: "Sí me parece bien, cómo hago para reservar", timestamp: new Date(Date.now() - 5 * 60000).toISOString() }
    ],
    expectativas: ["Pide anticipo 25%", "Menciona datos de transferencia", "No da precio mínimo", "Mensaje corto"],
  },

  {
    id: 3,
    nivel: "FÁCIL",
    descripcion: "Boda — cliente pide información general",
    lead: {
      id: 1003, nombre: "Carlos Vera",
      etapa_actual: "contacto_inicial", etapaId: 68329668,
      tipo_evento: ["boda"], servicios_interes: [],
      pausar_ia: false,
      timestamp_creacion: Date.now() / 1000 - 3600,
      timestamp_actualizacion: Date.now() / 1000 - 1200,
    },
    historial: [
      { role: "lead", content: "Hola me pasaron el contacto, quiero ver opciones para mi boda en julio", timestamp: new Date(Date.now() - 20 * 60000).toISOString() },
      { role: "bot", content: "Hola Carlos 👋 Trabajamos bodas con el 360 — videos instantáneos que los invitados se llevan esa noche. ¿Para cuántos invitados sería?", timestamp: new Date(Date.now() - 18 * 60000).toISOString() },
      { role: "lead", content: "Serían como 200 personas, sería en Sangolquí", timestamp: new Date(Date.now() - 5 * 60000).toISOString() }
    ],
    expectativas: ["Menciona precio correcto para Quito/valles", "Sangolquí está en el valle — tarifa normal", "Pregunta por duración o fecha exacta"],
  },

  // ─── MEDIO ───────────────────────────────────────────────────────────────
  {
    id: 4,
    nivel: "MEDIO",
    descripcion: "Objeción de precio — cliente dice que está caro",
    lead: {
      id: 1004, nombre: "Andrea Morales",
      etapa_actual: "negociacion", etapaId: 68329672,
      tipo_evento: ["quinceanos"], servicios_interes: ["videobooth_360"],
      pausar_ia: false,
      timestamp_creacion: Date.now() / 1000 - 172800,
      timestamp_actualizacion: Date.now() / 1000 - 600,
    },
    historial: [
      { role: "bot", content: "Para tu quinceaños 2 horas del 360 son $210. Los videos salen en segundos para que los invitados los compartan. ¿Te ajusta ese valor?", timestamp: new Date(Date.now() - 60 * 60000).toISOString() },
      { role: "lead", content: "Me parece un poco caro la verdad, hay algún descuento?", timestamp: new Date(Date.now() - 10 * 60000).toISOString() }
    ],
    expectativas: ["NO baja precio directo", "Refuerza el valor", "Usa técnica de negociación nivel 1", "Hace una pregunta de cierre"],
  },

  {
    id: 5,
    nivel: "MEDIO",
    descripcion: "Cliente pide combo fotobooth + niebla",
    lead: {
      id: 1005, nombre: "Roberto Chávez",
      etapa_actual: "contacto_inicial", etapaId: 68329668,
      tipo_evento: ["boda"], servicios_interes: [],
      pausar_ia: false,
      timestamp_creacion: Date.now() / 1000 - 7200,
      timestamp_actualizacion: Date.now() / 1000 - 300,
    },
    historial: [
      { role: "lead", content: "Buenas, quiero cotizar fotobooth y la niebla baja para el vals de mi boda", timestamp: new Date(Date.now() - 30 * 60000).toISOString() },
      { role: "bot", content: "Hola Roberto! La niebla para el vals queda increíble en boda. ¿Ya tienes en mente la duración del evento?", timestamp: new Date(Date.now() - 28 * 60000).toISOString() },
      { role: "lead", content: "Sería como 4 horas el evento, en Quito norte", timestamp: new Date(Date.now() - 5 * 60000).toISOString() }
    ],
    expectativas: ["Cotiza 360 + niebla correctamente", "4h → precio entre $270+$100=$370", "Presenta upsell naturalmente", "Máximo 35 palabras"],
  },

  {
    id: 6,
    nivel: "MEDIO",
    descripcion: "Cliente de provincia — Latacunga",
    lead: {
      id: 1006, nombre: "Patricia Soto",
      etapa_actual: "contacto_inicial", etapaId: 68329668,
      tipo_evento: ["quinceanos"], servicios_interes: [],
      pausar_ia: false,
      timestamp_creacion: Date.now() / 1000 - 10800,
      timestamp_actualizacion: Date.now() / 1000 - 900,
    },
    historial: [
      { role: "lead", content: "Hola buenas tardes, quisiera saber si van a Latacunga para un evento de quinceaños", timestamp: new Date(Date.now() - 60 * 60000).toISOString() },
      { role: "bot", content: "Hola Patricia! Sí cubrimos Latacunga. Para provincia el servicio incluye mínimo 4 horas. ¿Para qué fecha sería el evento?", timestamp: new Date(Date.now() - 58 * 60000).toISOString() },
      { role: "lead", content: "Sería para el 20 de agosto, cuánto costaría?", timestamp: new Date(Date.now() - 10 * 60000).toISOString() }
    ],
    expectativas: ["Precio provincia: $450 para 4h", "No cotiza menos de 4h", "Crea entusiasmo por el 360"],
  },

  // ─── DIFÍCIL ──────────────────────────────────────────────────────────────
  {
    id: 7,
    nivel: "DIFÍCIL",
    descripcion: "Lead frío — 3 días sin respuesta, primer seguimiento",
    lead: {
      id: 1007, nombre: "Juan Torres",
      etapa_actual: "seguimiento", etapaId: 68659032,
      tipo_evento: ["corporativo"], servicios_interes: ["videobooth_360"],
      pausar_ia: false,
      timestamp_creacion: Date.now() / 1000 - 432000,
      timestamp_actualizacion: Date.now() / 1000 - 259200,
    },
    historial: [
      { role: "lead", content: "Buenas, me interesa el 360 para un evento corporativo de 300 personas", timestamp: new Date(Date.now() - 5 * 24 * 3600000).toISOString() },
      { role: "bot", content: "Hola Juan! Para evento corporativo de 300 personas el 360 genera contenido para redes al instante. **¿Ya tienen fecha confirmada?**", timestamp: new Date(Date.now() - 4.9 * 24 * 3600000).toISOString() },
      { role: "bot", content: "Juan, solo para verificar disponibilidad en tu fecha — ¿sigues evaluando opciones para el evento?", timestamp: new Date(Date.now() - 3 * 24 * 3600000).toISOString() }
    ],
    expectativas: ["Tono de seguimiento sin ser insistente", "Crea curiosidad / urgencia", "No da precio sin datos", "Diferente al mensaje anterior"],
  },

  {
    id: 8,
    nivel: "DIFÍCIL",
    descripcion: "Negociación dura — cliente pide $100 por 2 horas",
    lead: {
      id: 1008, nombre: "Diego Ramírez",
      etapa_actual: "negociacion", etapaId: 68329672,
      tipo_evento: ["cumpleanos"], servicios_interes: ["videobooth_360"],
      pausar_ia: false,
      timestamp_creacion: Date.now() / 1000 - 86400,
      timestamp_actualizacion: Date.now() / 1000 - 1800,
    },
    historial: [
      { role: "bot", content: "Para 2 horas del 360 el valor es $210. Incluye equipo, 2 operadores y videos instantáneos. **¿Te ajusta?**", timestamp: new Date(Date.now() - 2 * 3600000).toISOString() },
      { role: "lead", content: "La verdad me parece demasiado caro, yo tengo $100 nada más para el fotobooth", timestamp: new Date(Date.now() - 90 * 60000).toISOString() },
      { role: "bot", content: "Entiendo, el valor incluye todo el equipo profesional y 2 operadores. ¿Qué parte del precio te genera duda?", timestamp: new Date(Date.now() - 85 * 60000).toISOString() },
      { role: "lead", content: "Es que de verdad solo tengo $100 es lo máximo que puedo pagar por eso", timestamp: new Date(Date.now() - 10 * 60000).toISOString() }
    ],
    expectativas: [
      "No acepta $100 para 2h (mínimo es $180)",
      "Ofrece 1 hora a $100 si le ajusta presupuesto",
      "No pierde el lead — busca alternativa viable",
      "Tono empático"
    ],
  },

  {
    id: 9,
    nivel: "DIFÍCIL",
    descripcion: "Comparación con competencia — dice que otro le da lo mismo más barato",
    lead: {
      id: 1009, nombre: "Sofía Bernal",
      etapa_actual: "negociacion", etapaId: 68329672,
      tipo_evento: ["boda"], servicios_interes: ["videobooth_360"],
      pausar_ia: false,
      timestamp_creacion: Date.now() / 1000 - 259200,
      timestamp_actualizacion: Date.now() / 1000 - 3600,
    },
    historial: [
      { role: "bot", content: "Para tu boda 3 horas del 360 quedan perfectas — cubres llegada, vals y pista. Son $270. **¿Te separamos esa fecha?**", timestamp: new Date(Date.now() - 24 * 3600000).toISOString() },
      { role: "lead", content: "Vi que otra empresa cobra $150 por lo mismo, cómo justifican $270?", timestamp: new Date(Date.now() - 4 * 3600000).toISOString() }
    ],
    expectativas: [
      "No ataca a la competencia",
      "Diferencia calidad: slow motion, entrega instantánea, operadores certificados",
      "Usa cierre rebote",
      "No baja precio directo"
    ],
  },

  // ─── EXTREMADAMENTE DIFÍCIL ───────────────────────────────────────────────
  {
    id: 10,
    nivel: "EXTREMO",
    descripcion: "Cliente tóxico — múltiples objeciones, cambia de mente, pide factura, evento en 4 días",
    lead: {
      id: 1010, nombre: "Fernando Espinoza",
      etapa_actual: "negociacion", etapaId: 68329672,
      tipo_evento: ["corporativo"], servicios_interes: ["videobooth_360", "niebla_baja"],
      pausar_ia: false,
      timestamp_creacion: Date.now() / 1000 - 604800,
      timestamp_actualizacion: Date.now() / 1000 - 7200,
    },
    historial: [
      { role: "lead", content: "Quiero el 360 y la niebla para un evento de empresa el viernes, 8 horas", timestamp: new Date(Date.now() - 5 * 24 * 3600000).toISOString() },
      { role: "bot", content: "Para 8 horas del 360 + niebla el valor es $740 (640 + 100). Para eventos corporativos generamos contenido de marca al instante. **¿Cuántos asistentes serían?**", timestamp: new Date(Date.now() - 4.9 * 24 * 3600000).toISOString() },
      { role: "lead", content: "300 personas pero me parece caro, tienen descuento para empresas?", timestamp: new Date(Date.now() - 4 * 24 * 3600000).toISOString() },
      { role: "bot", content: "Para eventos de más de $500 puedo ajustar la tarifa a $70/hora. Por 8 horas quedaría en $660. **¿Necesitan factura?**", timestamp: new Date(Date.now() - 3.9 * 24 * 3600000).toISOString() },
      { role: "lead", content: "Sí necesitamos factura, y ahora quiero solo 4 horas no 8, pero con fotobooth también", timestamp: new Date(Date.now() - 2 * 24 * 3600000).toISOString() },
      { role: "bot", content: "Para 4h del 360 + fotobooth con factura (IVA 15%): $270 + $270 + IVA = $621. **¿Con eso separamos el viernes?**", timestamp: new Date(Date.now() - 1.9 * 24 * 3600000).toISOString() },
      { role: "lead", content: "Espera ahora quiero saber si la niebla baja funciona para un auditorio, y me parece mucho $621", timestamp: new Date(Date.now() - 3 * 3600000).toISOString() }
    ],
    expectativas: [
      "Escalación urgente: evento en 4 días + monto >$600",
      "Clarifica si niebla funciona en auditorio (espacio cerrado — depende ventilación)",
      "Mantiene precio con IVA ya que pidió factura",
      "Considera escalar a humano por complejidad"
    ],
  },
];

// ─── Pipeline de prueba ───────────────────────────────────────────────────────

async function probarEscenario(escenario) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`${C.bold}${C.cyan}ESCENARIO ${escenario.id} [${escenario.nivel}]: ${escenario.descripcion}${C.reset}`);
  console.log(`${"═".repeat(70)}`);

  // Historial legible
  console.log(`\n${C.gris}--- HISTORIAL ---${C.reset}`);
  for (const m of escenario.historial) {
    const who = m.role === "lead" ? `${C.amarillo}CLIENTE${C.reset}` : `${C.cyan}BOT${C.reset}`;
    console.log(`${who}: ${m.content}`);
  }

  // PASO 1: Agente de Contexto
  console.log(`\n${C.magenta}[1/3] Agente Contexto extrayendo...${C.reset}`);
  let contexto;
  try {
    contexto = await extraerContexto(escenario.lead, escenario.historial);
    console.log(`${C.verde}✓ Contexto:${C.reset}`, JSON.stringify({
      etapa: contexto.etapa_actual,
      nivel_negociacion: contexto.nivel_negociacion,
      tono_cliente: contexto.tono_cliente,
      siguiente_accion: contexto.siguiente_accion_recomendada,
      objeciones: contexto.objeciones_detectadas,
    }, null, 2));
  } catch (err) {
    console.log(`${C.rojo}✗ Error contexto: ${err.message}${C.reset}`);
    return { id: escenario.id, error: "contexto", mensaje: err.message };
  }

  // PASO 2: Supervisor decide
  console.log(`\n${C.magenta}[2/3] Supervisor evaluando...${C.reset}`);
  let plan;
  try {
    plan = await evaluarEmbudo([{
      ...escenario.lead,
      telefono: `5939${String(escenario.id).padStart(8, "0")}`,
      historial_resumen: contexto.resumen_conversacion || "",
      tiempo_sin_respuesta_horas: calcularHorasSinRespuesta(escenario.historial),
      ultimo_mensaje_cliente: escenario.historial.filter(m => m.role === "lead").slice(-1)[0]?.content || "",
      objeciones_detectadas: contexto.objeciones_detectadas,
      alertas_previas: [],
    }]);

    const accion = plan.acciones?.[0];
    if (accion) {
      console.log(`${C.verde}✓ Decisión supervisor:${C.reset}`, JSON.stringify({
        prioridad: accion.prioridad,
        accion: accion.accion,
        agente: accion.agente_destino,
        nueva_etapa: accion.nueva_etapa,
        instruccion: accion.instruccion_agente,
        razon: accion.razon_decision,
      }, null, 2));
    } else {
      console.log(`${C.amarillo}⚠ Supervisor: esperar (${plan.leads_en_espera?.[0]?.razon})${C.reset}`);
      return { id: escenario.id, resultado: "esperar", plan };
    }
  } catch (err) {
    console.log(`${C.rojo}✗ Error supervisor: ${err.message}${C.reset}`);
    return { id: escenario.id, error: "supervisor", mensaje: err.message };
  }

  const accion = plan.acciones[0];
  if (accion.agente_destino === "humano") {
    console.log(`${C.amarillo}→ ESCALADO A HUMANO: ${accion.razon_decision}${C.reset}`);
    return { id: escenario.id, resultado: "escalado", razon: accion.razon_decision };
  }

  // PASO 3: Agente de Etapa genera borrador → QA revisa
  console.log(`\n${C.magenta}[3/3] Agente ${accion.agente_destino} generando + QA...${C.reset}`);

  let mensajeAprobado = null;
  let intentos = 0;
  const MAX_QA = 3;

  while (intentos < MAX_QA && !mensajeAprobado) {
    intentos++;

    let borrador;
    try {
      borrador = await generarMensaje(accion.agente_destino, contexto, accion.instruccion_agente, escenario.historial);
      console.log(`\n${C.gris}Borrador (intento ${intentos}): "${borrador}"${C.reset}`);
    } catch (err) {
      console.log(`${C.rojo}✗ Error agente etapa: ${err.message}${C.reset}`);
      break;
    }

    let revision;
    try {
      revision = await revisarMensaje(borrador, contexto, escenario.historial, accion.instruccion_agente);
    } catch (err) {
      console.log(`${C.rojo}✗ Error QA: ${err.message}${C.reset}`);
      break;
    }

    if (revision.decision === "APRUEBA") {
      mensajeAprobado = revision.mensaje_final || borrador;
      console.log(`${C.verde}✓ QA aprobado (intento ${intentos})${C.reset}`);
    } else {
      console.log(`${C.amarillo}✗ QA rechazó: ${revision.razones?.join(", ")}${C.reset}`);
      accion.instruccion_agente += `\n\nCORRECCIÓN QA: ${revision.correcciones_sugeridas}`;
    }
  }

  // ─── Resultado final ───────────────────────────────────────────────────────

  console.log(`\n${"─".repeat(70)}`);
  if (mensajeAprobado) {
    const palabras = mensajeAprobado.split(/\s+/).length;
    const tieneMultiplePreguntas = (mensajeAprobado.match(/\?/g) || []).length > 1;
    const tieneAI = /\b(soy un bot|soy IA|artificial|inteligencia artificial)\b/i.test(mensajeAprobado);

    console.log(`${C.verde}${C.bold}✅ MENSAJE FINAL:${C.reset}`);
    console.log(`${C.bold}"${mensajeAprobado}"${C.reset}`);
    console.log(`\n${C.gris}Palabras: ${palabras}/35 ${palabras > 35 ? C.rojo + "⚠ SUPERA LÍMITE" + C.reset : C.verde + "✓" + C.reset}`);
    if (tieneMultiplePreguntas) console.log(`${C.rojo}⚠ TIENE MÚLTIPLES PREGUNTAS${C.reset}`);
    if (tieneAI) console.log(`${C.rojo}⚠ MENCIONA IA/BOT${C.reset}`);
  } else {
    console.log(`${C.rojo}${C.bold}❌ NO SE GENERÓ MENSAJE (QA rechazó ${MAX_QA} veces → escalar humano)${C.reset}`);
  }

  // Validar expectativas
  console.log(`\n${C.gris}Expectativas de este escenario:${C.reset}`);
  for (const exp of escenario.expectativas) {
    console.log(`  ${C.gris}·${C.reset} ${exp}`);
  }

  return {
    id: escenario.id,
    resultado: mensajeAprobado ? "ok" : "fallido",
    mensaje: mensajeAprobado,
    palabras: mensajeAprobado?.split(/\s+/).length,
    intentosQA: intentos,
    decision_supervisor: accion.accion,
    agente_usado: accion.agente_destino,
    prioridad: accion.prioridad,
  };
}

// ─── Utilitario ───────────────────────────────────────────────────────────────

function calcularHorasSinRespuesta(historial) {
  const ultCliente = historial.filter(m => m.role === "lead").slice(-1)[0];
  if (!ultCliente) return 999;
  return (Date.now() - new Date(ultCliente.timestamp).getTime()) / 3600000;
}

// ─── Runner principal ─────────────────────────────────────────────────────────

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error(`${C.rojo}ERROR: OPENAI_API_KEY no configurada en .env${C.reset}`);
    process.exit(1);
  }

  // Selección por argumento: node test_10_clientes.js 3  → solo escenario 3
  const soloId = process.argv[2] ? parseInt(process.argv[2]) : null;
  const escenarios = soloId
    ? ESCENARIOS.filter(e => e.id === soloId)
    : ESCENARIOS;

  console.log(`\n${C.bold}${"═".repeat(70)}`);
  console.log(`  TEST 360 EVENTOS — ${escenarios.length} escenarios`);
  console.log(`${"═".repeat(70)}${C.reset}`);

  const resultados = [];

  for (const escenario of escenarios) {
    try {
      const res = await probarEscenario(escenario);
      resultados.push(res);
    } catch (err) {
      console.error(`${C.rojo}Error fatal escenario ${escenario.id}: ${err.message}${C.reset}`);
      resultados.push({ id: escenario.id, error: "fatal", mensaje: err.message });
    }

    // Pausa entre escenarios para no saturar OpenAI
    if (escenarios.indexOf(escenario) < escenarios.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ─── Resumen final ─────────────────────────────────────────────────────────

  console.log(`\n\n${"═".repeat(70)}`);
  console.log(`${C.bold}  RESUMEN FINAL${C.reset}`);
  console.log(`${"═".repeat(70)}`);

  let ok = 0, escalados = 0, fallidos = 0;

  for (const r of resultados) {
    const escenario = ESCENARIOS.find(e => e.id === r.id);
    let icono, color;
    if (r.error) { icono = "❌ ERROR"; color = C.rojo; fallidos++; }
    else if (r.resultado === "escalado") { icono = "⚡ ESCALADO"; color = C.amarillo; escalados++; }
    else if (r.resultado === "esperar") { icono = "⏸  ESPERAR"; color = C.gris; }
    else if (r.resultado === "ok") { icono = "✅ OK"; color = C.verde; ok++; }
    else { icono = "✗ FALLIDO"; color = C.rojo; fallidos++; }

    const palabras = r.palabras ? `(${r.palabras}p)` : "";
    console.log(`  ${color}${icono}${C.reset} [${escenario.nivel.padEnd(6)}] ${escenario.descripcion} ${C.gris}${palabras}${C.reset}`);
    if (r.mensaje) console.log(`       ${C.gris}"${r.mensaje.substring(0, 80)}${r.mensaje.length > 80 ? "..." : ""}"${C.reset}`);
  }

  console.log(`\n  Total: ${C.verde}${ok} exitosos${C.reset} | ${C.amarillo}${escalados} escalados${C.reset} | ${C.rojo}${fallidos} fallidos${C.reset}`);
  console.log(`${"═".repeat(70)}\n`);
}

main().catch(err => {
  console.error("Error fatal:", err);
  process.exit(1);
});
