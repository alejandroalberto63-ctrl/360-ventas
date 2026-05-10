/**
 * Pipeline Principal — 360 Eventos
 * Orquesta los 3 agentes: Contexto → Ventas → QA → Envío
 *
 * Este módulo es llamado por n8n vía webhook o HTTP call.
 */

const { extraerContexto } = require("./agente_contexto");
const { generarRespuesta } = require("./agente_ventas");
const { revisarMensaje } = require("./agente_qa");

const MAX_REINTENTOS = 3;

/**
 * Ejecuta el pipeline completo para un lead
 *
 * @param {object} leadData - Datos del lead desde EspoCRM
 * @param {Array} historial - Historial de mensajes
 * @param {string} instruccion - Qué debe hacer el agente de ventas
 * @param {string} mensajeCliente - Último mensaje del cliente (opcional)
 * @returns {{ mensaje: string, aprobado: boolean, intentos: number, escalado: boolean }}
 */
async function ejecutarPipeline(leadData, historial, instruccion, mensajeCliente = null) {
  console.log(`[Pipeline] Lead: ${leadData.id} | Instrucción: ${instruccion}`);

  // PASO 1: Extraer contexto
  const contexto = await extraerContexto(leadData, historial);
  console.log(`[Contexto] Etapa: ${contexto.etapa_actual} | Tono: ${contexto.tono_cliente}`);

  // Verificar alertas críticas
  if (contexto.alertas && contexto.alertas.length > 0) {
    console.warn(`[ALERTA] ${contexto.alertas.join(", ")}`);
    // Si hay alerta crítica, escalar a humano sin generar mensaje
    if (contexto.alertas.some(a => a.toLowerCase().includes("humano"))) {
      return {
        mensaje: null,
        aprobado: false,
        intentos: 0,
        escalado: true,
        razon_escalado: contexto.alertas.join(", "),
        contexto,
      };
    }
  }

  let intentos = 0;
  let ultimoRechazo = null;

  while (intentos < MAX_REINTENTOS) {
    intentos++;

    // PASO 2: Agente de Ventas genera respuesta
    const instruccionConFeedback = ultimoRechazo
      ? `${instruccion}\n\nCORRECCIÓN REQUERIDA (intento ${intentos}): ${ultimoRechazo}`
      : instruccion;

    const borrador = await generarRespuesta(contexto, instruccionConFeedback, mensajeCliente);
    console.log(`[Ventas] Intento ${intentos}: "${borrador.substring(0, 80)}..."`);

    // PASO 3: Agente QA revisa
    const revision = await revisarMensaje(borrador, contexto, historial, instruccion);
    console.log(`[QA] Decisión: ${revision.decision}`);

    if (revision.decision === "APRUEBA") {
      return {
        mensaje: revision.mensaje_final,
        aprobado: true,
        intentos,
        escalado: false,
        notas_qa: revision.notas || null,
        contexto,
      };
    }

    // QA rechazó — preparar corrección para siguiente intento
    ultimoRechazo = revision.correcciones_sugeridas;
    console.warn(`[QA] Rechazado: ${revision.razones?.join(", ")}`);
  }

  // Agotamos reintentos → escalar a humano
  console.error(`[Pipeline] 3 reintentos agotados para lead ${leadData.id} — escalando`);
  return {
    mensaje: null,
    aprobado: false,
    intentos: MAX_REINTENTOS,
    escalado: true,
    razon_escalado: `QA rechazó ${MAX_REINTENTOS} intentos: ${ultimoRechazo}`,
    contexto,
  };
}

module.exports = { ejecutarPipeline };
