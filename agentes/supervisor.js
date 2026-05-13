const { llamarJSON } = require("./openai_client");
const fs = require("fs");
const path = require("path");

const PROMPT = fs.readFileSync(path.join(__dirname, "../prompts/supervisor.md"), "utf8");

/**
 * Evalúa UN solo lead y devuelve UNA sola decisión de acción.
 * Todos los agentes (contexto, etapa, QA) ya operan por lead — ahora el
 * supervisor también. No se mezclan leads entre sí.
 *
 * @param {object} lead  — lead enriquecido con contexto, historial_resumen,
 *                         tiempo_sin_respuesta_horas, etc.
 * @returns {object}  — { accion, agente_destino, instruccion_agente,
 *                         razon_decision, nueva_etapa, prioridad, alerta }
 */
async function evaluarLead(lead) {
  const ahora = new Date();
  const fechaHoy = ahora.toLocaleDateString("es-EC", {
    timeZone: "America/Guayaquil",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const fechaISO = ahora.toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });

  // Enviamos el contexto completo del lead — sin historial raw (demasiado pesado)
  const leadParaSupervisor = {
    lead_id:                    lead.id,
    nombre:                     lead.nombre,
    telefono:                   lead.telefono,
    etapa_actual:               lead.etapa_actual,
    tiempo_sin_respuesta_horas: lead.tiempo_sin_respuesta_horas,
    ultimo_mensaje_cliente:     lead.contexto?.ultimo_mensaje_cliente || lead.contexto?.conversacion?.ultimo_mensaje_cliente || "",
    ultimo_mensaje_bot:         lead.contexto?.conversacion?.ultimo_mensaje_bot || "",
    historial_resumen:          lead.contexto?.resumen_conversacion || lead.contexto?.conversacion?.resumen || "",
    tipo_evento:                lead.tipo_evento || lead.contexto?.datos_evento?.tipo || null,
    servicios_interes:          lead.servicios_interes || [],
    pausar_ia:                  lead.pausar_ia || false,
    nivel_negociacion:          lead.contexto?.nivel_negociacion ?? lead.contexto?.comercial?.nivel_negociacion_actual ?? 0,
    precio_cotizado:            lead.contexto?.comercial?.precio_cotizado ?? null,
    num_seguimientos_enviados:  lead.contexto?.conversacion?.num_seguimientos_enviados ?? 0,
    espera_indicada:            lead.contexto?.espera_indicada || null,
    alertas:                    lead.contexto?.alertas || [],
    tono_cliente:               lead.contexto?.tono_cliente || lead.contexto?.conversacion?.tono_cliente || "neutro",
    datos_evento:               lead.contexto?.datos_evento || null,
    timestamp_creacion:         lead.timestamp_creacion || null,
  };

  const user = `FECHA_HOY: ${fechaHoy} (${fechaISO})

Evalúa este lead y decide qué hacer:

${JSON.stringify({ timestamp_ciclo: ahora.toISOString(), lead: leadParaSupervisor }, null, 2)}`;

  console.log(`[Supervisor] Evaluando lead ${lead.id} (${lead.nombre || lead.telefono})...`);
  return llamarJSON(PROMPT, user, { temperature: 0.3, maxTokens: 800 });
}

module.exports = { evaluarLead };
