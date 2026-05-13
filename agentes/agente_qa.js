const { llamarJSON } = require("./openai_client");
const fs = require("fs");
const path = require("path");

const PROMPT = fs.readFileSync(path.join(__dirname, "../prompts/agente_qa.md"), "utf8");

function contarPalabras(texto) {
  return texto.trim().split(/\s+/).filter(Boolean).length;
}

function contarEmojis(texto) {
  // Matches emoji presentation characters
  return (texto.match(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu) || []).length;
}

async function revisarMensaje(mensajePropuesto, contexto, historial, instruccionOriginal) {
  const numPalabras = contarPalabras(mensajePropuesto);
  const numEmojis = contarEmojis(mensajePropuesto);

  const user = JSON.stringify({
    mensaje_propuesto: mensajePropuesto,
    conteo_palabras_exacto: numPalabras,
    conteo_emojis_exacto: numEmojis,
    contexto_lead: contexto,
    historial_reciente: (historial || []).slice(-5).map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
    etapa: contexto.etapa_actual,
    instruccion_original: instruccionOriginal,
  }, null, 2);

  return llamarJSON(PROMPT, user, { temperature: 0.1, maxTokens: 512 });
}

module.exports = { revisarMensaje };
