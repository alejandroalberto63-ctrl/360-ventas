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

  const esPrimerContacto = instruccion.toLowerCase().includes("primer contacto proactivo");

  const user = `ETAPA: ${etapa.toUpperCase()}

CONTEXTO DEL LEAD:
${JSON.stringify(contexto, null, 2)}

HISTORIAL RECIENTE:
${historialTexto || "(primer contacto)"}

INSTRUCCIÓN DEL SUPERVISOR:
${instruccion}

${esPrimerContacto
  ? `⚠️ INSTRUCCIÓN CRÍTICA: Copia el template indicado EXACTAMENTE, palabra por palabra, incluyendo emojis, saltos de línea y formato. El límite de 35 palabras NO aplica a templates de primer contacto. NO improvises, NO resumas, NO cambies nada.`
  : `⚠️ LÍMITE ESTRICTO: MÁXIMO 35 PALABRAS (cuenta separando por espacios). Ejemplo correcto con 22 palabras: "Para tu boda el 360 genera videos que los invitados se llevan al instante. **¿Para qué fecha sería?**"`
}

Genera SOLO el texto del mensaje. Sin comillas, sin explicaciones, sin prefijos.`;

  return llamarMini(prompt, user, { temperature: esPrimerContacto ? 0 : 0.75, maxTokens: esPrimerContacto ? 600 : 200 });
}

module.exports = { generarMensaje };
