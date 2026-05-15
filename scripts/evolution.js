/**
 * Adaptador Evolution API — Canal 360 Eventos
 *
 * Instancia de ventas (593980243197): habla con clientes.
 * Instancia sistema  (593987841594): notificaciones internas — nunca habla con clientes.
 */

const config = require("./config");

const BASE = config.whatsapp.apiUrl;

// ─── Instancia canal ventas (cliente) ────────────────────────────────────────
const INSTANCE = config.whatsapp.instance;
const HEADERS = {
  apikey: config.whatsapp.apiKey,
  "Content-Type": "application/json",
};

// ─── Instancia Marketa System (notificaciones internas) ──────────────────────
const SISTEMA_INSTANCE = config.sistema.instance; // marketa_system
const SISTEMA_HEADERS = {
  apikey: config.whatsapp.apiKey, // misma API key, distinta instancia
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
 * Envía notificación interna.
 * Intenta primero desde marketa_system (593987841594).
 * Si esa instancia no existe o falla, hace fallback a 360eventos con prefijo [🔔].
 * NUNCA usar para hablar con clientes — solo coordinador y dueño.
 * @param {string} telefono - Número destino (coordinador, dueño)
 * @param {string} texto - Mensaje a enviar
 */
async function enviarSistema(telefono, texto) {
  const telefonoLimpio = String(telefono).replace(/\D/g, "");

  // ── Intento 1: marketa_system ────────────────────────────────────────────
  try {
    const url = `${BASE}/message/sendText/${SISTEMA_INSTANCE}`;
    const res = await fetch(url, {
      method: "POST",
      headers: SISTEMA_HEADERS,
      body: JSON.stringify({ number: telefonoLimpio, text: texto, delay: 800 }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[Sistema] ✓ Notificación enviada desde marketa_system a ${telefonoLimpio} | ID: ${data?.key?.id}`);
      return data;
    }

    const errBody = await res.text();
    console.warn(`[Sistema] marketa_system falló (${res.status}) — usando fallback 360eventos. ${errBody}`);
  } catch (err) {
    console.warn(`[Sistema] marketa_system no disponible — usando fallback 360eventos. ${err.message}`);
  }

  // ── Fallback: 360eventos (solo para internos — coordinador/dueño) ────────
  try {
    const url = `${BASE}/message/sendText/${INSTANCE}`;
    const textoFallback = `[🔔 SISTEMA]\n${texto}`;
    const res = await fetch(url, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ number: telefonoLimpio, text: textoFallback, delay: 800 }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn(`[Sistema] Fallback 360eventos también falló: ${res.status} — ${err}`);
      return null;
    }

    const data = await res.json();
    console.log(`[Sistema] ✓ Notificación enviada vía fallback 360eventos a ${telefonoLimpio} | ID: ${data?.key?.id}`);
    return data;
  } catch (err) {
    console.warn(`[Sistema] No se pudo notificar por ningún canal: ${err.message}`);
    return null;
  }
}

/**
 * Envía alerta de escalado a Erika (coordinadora) y Alberto (dueño)
 * Usa el número Marketa System — no el canal de ventas.
 */
async function alertarCoordinador(mensaje) {
  const texto = `⚠️ ALERTA 360 EVENTOS\n\n${mensaje}`;
  const destinos = [config.supervisor.waCoordinador, config.supervisor.waDueno].filter(Boolean);

  if (destinos.length === 0) {
    console.warn("[Sistema] WA_COORDINADOR_360 / WA_DUENO_360 no configurados");
    return;
  }

  for (const numero of destinos) {
    await enviarSistema(numero, texto);
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

// ─── Catálogo de videos demo ──────────────────────────────────────────────
// URLs migradas desde el workflow n8n "Enviar Video 360" (GoNB1GufBFdcRDHE)
const CATALOGO_VIDEOS = {
  boda: {
    media: "https://drive.google.com/uc?export=download&id=16bCR86dTE8lih_aAIIVFPXaO3dkXzskv",
    caption: "¡Aquí tienes una muestra de nuestro trabajo para bodas! 🎥✨",
    fileName: "video_boda.mp4",
  },
  quinceanos: {
    media: "https://drive.google.com/uc?export=download&id=1Q7BpjQ-ValpQLa5QCVJSxh_aDhIgKZ22",
    caption: "¡Aquí tienes una muestra de nuestro trabajo en fiestas de 15 años! 👑✨",
    fileName: "video_15_anos.mp4",
  },
  graduacion: {
    media: "https://drive.usercontent.google.com/download?id=1WOy74VC6ujqEoKVHI8OqScEUT304rQwP&export=download",
    caption: "¡Aquí tienes una muestra de nuestro trabajo en graduaciones! 🎓✨",
    fileName: "video_graduacion.mp4",
  },
  corporativo: {
    media: "https://drive.google.com/uc?export=download&id=1ldigD-vploetRlJfqdbrDekMYe07nAyY",
    caption: "¡Aquí tienes una muestra de nuestro trabajo en eventos corporativos! 🏢✨",
    fileName: "video_corporativo.mp4",
  },
  photobooth: {
    media: "https://drive.google.com/uc?export=download&id=1BAsHGzBsQI4STSYHXcUVaMPFyCVOdbu3",
    caption: "¡Mira lo divertidas que salen las fotos con nuestro PhotoBooth y el cotillón! 📸✨",
    fileName: "photobooth.mp4",
  },
  efectos: {
    media: "https://drive.google.com/uc?export=download&id=1H4Ix1hjhB42Zytg-EAaGFXslVXStNZCR",
    caption: "¡Mira cómo lucen nuestros efectos especiales para hacer tu momento inolvidable! ✨💨",
    fileName: "efecto.mp4",
  },
  // Demo general del VideoBooth 360 (cuando el cliente pregunta por el 360 sin especificar evento)
  videobooth: {
    media: "https://drive.google.com/uc?export=download&id=16bCR86dTE8lih_aAIIVFPXaO3dkXzskv",
    caption: "¡Así luce el VideoBooth 360 en acción! Slow motion, luces LED y video al instante 🎡✨",
    fileName: "video_360_demo.mp4",
  },
};

// Aliases para tipos de evento que el agente usa con nombres distintos
const ALIASES_VIDEO = {
  "15_anos": "quinceanos",
  "15años": "quinceanos",
  "quince": "quinceanos",
  "boda": "boda",
  "bodas": "boda",
  "grado": "graduacion",
  "graduacion": "graduacion",
  "graduación": "graduacion",
  "corporativo": "corporativo",
  "empresarial": "corporativo",
  "photobooth": "photobooth",
  "photo_booth": "photobooth",
  "fotobooth": "photobooth",
  "efectos": "efectos",
  "niebla": "efectos",
  "pirotecnia": "efectos",
  "videobooth": "videobooth",
  "360": "videobooth",
  "video360": "videobooth",
};

/**
 * Resuelve un tipo de evento (con aliases) a la clave del catálogo.
 * Devuelve null si no hay video para ese tipo.
 */
function resolverTipoVideo(tipoEvento) {
  if (!tipoEvento) return null;
  const key = String(tipoEvento).toLowerCase().trim();
  return ALIASES_VIDEO[key] || (CATALOGO_VIDEOS[key] ? key : null);
}

/**
 * Envía un video demo según el tipo de evento.
 * @param {string} telefono - Número destino (solo dígitos)
 * @param {string} tipoEvento - boda | quinceanos | graduacion | corporativo | photobooth | efectos
 * @returns {object|null} Respuesta de Evolution o null si el tipo no existe.
 */
async function enviarVideo(telefono, tipoEvento) {
  const clave = resolverTipoVideo(tipoEvento);
  if (!clave) {
    console.warn(`[Evolution] No hay video demo para tipo "${tipoEvento}"`);
    return null;
  }
  const video = CATALOGO_VIDEOS[clave];
  const telefonoLimpio = telefono.replace(/\D/g, "");
  const url = `${BASE}/message/sendMedia/${INSTANCE}`;

  const body = {
    number: telefonoLimpio,
    mediatype: "video",
    mimetype: "video/mp4",
    media: video.media,
    caption: video.caption,
    fileName: video.fileName,
    delay: 1500,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Evolution sendMedia error: ${res.status} — ${err}`);
  }

  const data = await res.json();
  console.log(`[Evolution] 🎥 Video "${clave}" enviado a ${telefonoLimpio} | ID: ${data?.key?.id}`);
  return { ...data, tipo_video: clave };
}

module.exports = {
  enviarMensaje,
  enviarSistema,
  enviarVideo,
  resolverTipoVideo,
  CATALOGO_VIDEOS,
  obtenerHistorial,
  obtenerImagenBase64,
  obtenerAudioBase64,
  obtenerMediaBase64,
  verificarConexion,
  alertarCoordinador,
};
