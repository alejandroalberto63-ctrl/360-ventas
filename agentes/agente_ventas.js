/**
 * Agente de Ventas — 360 Eventos
 * Genera mensajes de ventas personalizados según el contexto del lead
 */

const { llamar } = require("./openai_client");
const fs = require("fs");
const path = require("path");

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, "../prompts/agente_ventas.md"),
  "utf8"
);

/**
 * @param {object} contexto - Output del Agente de Contexto
 * @param {string} instruccion - Qué debe hacer en este turno
 * @param {string} mensajeCliente - Último mensaje del cliente (si aplica)
 * @returns {string} Texto del mensaje a enviar
 */
async function generarRespuesta(contexto, instruccion, mensajeCliente = null) {
  const userMessage = `CONTEXTO DEL LEAD:\n${JSON.stringify(contexto, null, 2)}\n\nINSTRUCCIÓN PARA ESTE TURNO:\n${instruccion}${mensajeCliente ? `\n\nÚLTIMO MENSAJE DEL CLIENTE:\n"${mensajeCliente}"` : ""}\n\nGenera el mensaje de respuesta.`;

  return llamar(SYSTEM_PROMPT, userMessage, { temperature: 0.75, maxTokens: 200 });
}

module.exports = { generarRespuesta };
