/**
 * Cliente OpenAI — 360 Eventos
 * Wrapper central para todas las llamadas a la API de OpenAI
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL       = "gpt-4o";        // Contexto + Supervisor: necesitan máximo razonamiento
const MODEL_MINI  = "gpt-4o-mini";   // QA + Agentes de etapa: tareas más simples, 16x más barato
const BASE = "https://api.openai.com/v1/chat/completions";

// ─── Contador de tokens por ciclo ─────────────────────────────────────────
// Se resetea al inicio de cada barrido y acumula todos los usos de LLM.

let _usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

function resetUsage() {
  _usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function getUsage() {
  return { ..._usage };
}

/**
 * Calcula costo estimado en USD para gpt-4o.
 * Precios vigentes: $2.50/1M input · $10.00/1M output
 */
function calcularCostoUSD(usage) {
  // Estimación conservadora: asume mitad de tokens en mini, mitad en gpt-4o
  // Para exactitud real ver OpenAI dashboard
  const input  = (usage.prompt_tokens     / 1_000_000) * 2.50;
  const output = (usage.completion_tokens / 1_000_000) * 10.00;
  return +(input + output).toFixed(5);
}

function _acumularUsage(uso) {
  if (!uso) return;
  _usage.prompt_tokens     += uso.prompt_tokens     || 0;
  _usage.completion_tokens += uso.completion_tokens || 0;
  _usage.total_tokens      += uso.total_tokens      || 0;
}

/**
 * Llama a OpenAI con system prompt + user content
 * @param {string} systemPrompt
 * @param {string} userContent
 * @param {object} opts - { temperature, json, maxTokens }
 * @returns {string} texto de respuesta
 */
async function llamar(systemPrompt, userContent, opts = {}) {
  const { temperature = 0.7, json = false, maxTokens = 1024 } = opts;

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  };

  if (json) body.response_format = { type: "json_object" };

  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err}`);
  }

  const data = await res.json();
  _acumularUsage(data.usage);
  return data.choices[0].message.content.trim();
}

/**
 * Llama y parsea JSON directamente (gpt-4o — contexto y supervisor)
 */
async function llamarJSON(systemPrompt, userContent, opts = {}) {
  const texto = await llamar(systemPrompt, userContent, { ...opts, json: true });
  try {
    return JSON.parse(texto);
  } catch {
    const match = texto.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("OpenAI no devolvió JSON válido");
    return JSON.parse(match[0]);
  }
}

/**
 * Igual que llamar pero con gpt-4o-mini (16x más barato — para QA y agentes de etapa)
 */
async function llamarMini(systemPrompt, userContent, opts = {}) {
  const { temperature = 0.7, json = false, maxTokens = 1024 } = opts;
  const body = {
    model: MODEL_MINI,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userContent  },
    ],
  };
  if (json) body.response_format = { type: "json_object" };

  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI mini error ${res.status}: ${err}`);
  }
  const data = await res.json();
  _acumularUsage(data.usage);
  return data.choices[0].message.content.trim();
}

/**
 * Llama con mini y parsea JSON (para QA y agentes de etapa)
 */
async function llamarJSONMini(systemPrompt, userContent, opts = {}) {
  const texto = await llamarMini(systemPrompt, userContent, { ...opts, json: true });
  try {
    return JSON.parse(texto);
  } catch {
    const match = texto.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("OpenAI mini no devolvió JSON válido");
    return JSON.parse(match[0]);
  }
}

/**
 * Llama a GPT-4o con una imagen (base64) y un prompt de texto
 * Usado para verificar comprobantes de pago
 * @param {string} systemPrompt
 * @param {string} textoPregunta - Instrucción sobre qué analizar en la imagen
 * @param {string} imagenBase64 - Imagen en base64
 * @param {string} mimeType - "image/jpeg" | "image/png" (default: "image/jpeg")
 * @returns {object} JSON parseado de la respuesta
 */
async function llamarConImagen(systemPrompt, textoPregunta, imagenBase64, mimeType = "image/jpeg") {
  const body = {
    model: MODEL,
    max_tokens: 512,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: textoPregunta },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imagenBase64}` },
          },
        ],
      },
    ],
  };

  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI vision error ${res.status}: ${err}`);
  }

  const data = await res.json();
  _acumularUsage(data.usage);
  const texto = data.choices[0].message.content.trim();
  try {
    return JSON.parse(texto);
  } catch {
    const match = texto.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("OpenAI vision no devolvió JSON válido");
    return JSON.parse(match[0]);
  }
}

/**
 * Transcribe audio (base64) usando Whisper de OpenAI
 * @param {string} base64Audio - Audio en base64 (sin prefijo data:)
 * @param {string} mimeType - "audio/ogg" | "audio/mpeg" | "audio/mp4" (default: "audio/ogg")
 * @param {string} idioma - Código ISO ("es" para español, default)
 * @returns {string} texto transcrito
 */
async function transcribirAudio(base64Audio, mimeType = "audio/ogg", idioma = "es") {
  const buffer = Buffer.from(base64Audio, "base64");

  // Determinar nombre de archivo según mime
  const ext = mimeType.includes("mpeg") ? "mp3"
            : mimeType.includes("mp4")  ? "m4a"
            : mimeType.includes("wav")  ? "wav"
            : "ogg";

  const formData = new FormData();
  formData.append("file", new Blob([buffer], { type: mimeType }), `audio.${ext}`);
  formData.append("model", "whisper-1");
  formData.append("language", idioma);
  formData.append("response_format", "json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return (data.text || "").trim();
}

module.exports = { llamar, llamarJSON, llamarMini, llamarJSONMini, llamarConImagen, transcribirAudio, resetUsage, getUsage, calcularCostoUSD };
