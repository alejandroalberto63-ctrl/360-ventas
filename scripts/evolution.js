/**
 * Adaptador Evolution API — Canal 360 Eventos
 *
 * Solo usa la instancia del número 593980243197.
 * No toca ninguna otra instancia.
 */

const config = require("./config");

const BASE = config.whatsapp.apiUrl;
const INSTANCE = config.whatsapp.instance;
const HEADERS = {
  apikey: config.whatsapp.apiKey,
  "Content-Type": "application/json",
};

/**
 * Envía un mensaje de texto al número de WhatsApp del lead
 * @param {string} telefono - Número destino (solo dígitos, con código país)
 * @param {string} texto - Mensaje a enviar
 */
async function enviarMensaje(telefono, texto) {
  const telefonoLimpio = telefono.replace(/\D/g, "");
  const url = `${BASE}/message/sendText/${INSTANCE}`;

  const body = {
    number: telefonoLimpio,
    text: texto,
    delay: 1200, // ms de delay para simular escritura humana
  };

  const res = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Evolution sendText error: ${res.status} — ${err}`);
  }

  const data = await res.json();
  console.log(`[Evolution] ✓ Mensaje enviado a ${telefonoLimpio} | ID: ${data?.key?.id}`);
  return data;
}

/**
 * Obtiene el historial de mensajes de una conversación
 * @param {string} telefono - Número del lead
 * @param {number} limite - Cantidad de mensajes a traer (default: 30)
 */
async function obtenerHistorial(telefono, limite = 30) {
  const telefonoLimpio = telefono.replace(/\D/g, "");
  const url = `${BASE}/chat/findMessages/${INSTANCE}`;

  const body = {
    where: {
      key: { remoteJid: `${telefonoLimpio}@s.whatsapp.net` },
    },
    limit: limite,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.warn(`[Evolution] No se pudo obtener historial de ${telefonoLimpio}: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const mensajes = data?.messages?.records || [];

  // Normalizar a formato interno
  return mensajes
    .filter((m) => m.message?.conversation || m.message?.extendedTextMessage?.text)
    .map((m) => ({
      id: m.key?.id,
      role: m.key?.fromMe ? "bot" : "lead",
      content: m.message?.conversation || m.message?.extendedTextMessage?.text || "",
      timestamp: new Date(m.messageTimestamp * 1000).toISOString(),
    }))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Verifica que la instancia 360 esté conectada
 */
async function verificarConexion() {
  const url = `${BASE}/instance/connectionState/${INSTANCE}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return false;
  const data = await res.json();
  return data?.instance?.state === "open";
}

/**
 * Envía alerta de escalado a Erika (coordinadora) y Alberto (dueño)
 */
async function alertarCoordinador(mensaje) {
  const texto = `⚠️ ALERTA 360 EVENTOS\n\n${mensaje}`;
  const destinos = [config.supervisor.waCoordinador, config.supervisor.waDueno].filter(Boolean);

  if (destinos.length === 0) {
    console.warn("[Evolution] WA_COORDINADOR_360 / WA_DUENO_360 no configurados");
    return;
  }

  for (const numero of destinos) {
    try {
      await enviarMensaje(numero, texto);
    } catch (err) {
      console.warn(`[Evolution] No se pudo alertar a ${numero}: ${err.message}`);
    }
  }
}

/**
 * Descarga el contenido base64 de un mensaje multimedia (imagen, audio, video, documento)
 * Evolution expone el mismo endpoint para todos los tipos.
 * @param {string} jid - RemoteJid del chat (ej: "5939...@s.whatsapp.net")
 * @param {string} messageId - ID del mensaje multimedia
 * @returns {string|null} base64 del archivo, o null si falla
 */
async function obtenerMediaBase64(jid, messageId) {
  const url = `${BASE}/chat/getBase64FromMediaMessage/${INSTANCE}`;

  const body = {
    message: {
      key: {
        remoteJid: jid,
        id: messageId,
        fromMe: false,
      },
    },
    convertToMp4: false,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.warn(`[Evolution] No se pudo descargar media ${messageId}: ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data?.base64 || null;
  } catch (err) {
    console.warn(`[Evolution] Error descargando media: ${err.message}`);
    return null;
  }
}

// Aliases semánticos
const obtenerImagenBase64 = obtenerMediaBase64;
const obtenerAudioBase64 = obtenerMediaBase64;

module.exports = {
  enviarMensaje,
  obtenerHistorial,
  obtenerImagenBase64,
  obtenerAudioBase64,
  obtenerMediaBase64,
  verificarConexion,
  alertarCoordinador,
};
