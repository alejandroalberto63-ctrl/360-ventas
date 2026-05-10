const { llamarJSON } = require("./openai_client");
const fs = require("fs");
const path = require("path");

const PROMPT = fs.readFileSync(path.join(__dirname, "../prompts/agente_contexto.md"), "utf8");

async function extraerContexto(leadData, historial) {
  const historialTexto = historial
    .map((m) => `[${m.timestamp}] ${m.role === "lead" ? "CLIENTE" : "BOT"}: ${m.content}`)
    .join("\n");

  // Si Evolution API no devuelve historial, usar LOG_CONVERSACION_WA de Kommo como respaldo
  let fuenteHistorial;
  if (historialTexto) {
    fuenteHistorial = `HISTORIAL WHATSAPP (Evolution API — fuente principal):\n${historialTexto}`;
  } else if (leadData.log_wa) {
    fuenteHistorial = `HISTORIAL WHATSAPP (LOG Kommo — fuente de respaldo, Evolution no devolvió mensajes):\n${leadData.log_wa}`;
  } else {
    fuenteHistorial = "HISTORIAL WHATSAPP: (sin mensajes aún)";
  }

  const user = `DATOS DEL LEAD:\n${JSON.stringify(leadData, null, 2)}\n\n${fuenteHistorial}`;

  const raw = await llamarJSON(PROMPT, user, { temperature: 0.2, maxTokens: 1024 });

  // Aliases planos para compatibilidad con ciclo_supervisor y agentes
  return {
    ...raw,
    resumen_conversacion:    raw.conversacion?.resumen              || "",
    ultimo_mensaje_cliente:  raw.conversacion?.ultimo_mensaje_cliente || "",
    objeciones_detectadas:   raw.conversacion?.objeciones           || [],
    tono_cliente:            raw.conversacion?.tono_cliente         || "interesado",
    nivel_negociacion:       raw.comercial?.nivel_negociacion_actual ?? 0,
  };
}

module.exports = { extraerContexto };
