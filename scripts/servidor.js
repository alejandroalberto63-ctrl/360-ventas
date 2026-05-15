/**
 * Servidor Express — Sistema 360 Eventos
 *
 * Recibe webhooks de Evolution API (número 593980243197)
 * y triggers de n8n para el ciclo del supervisor.
 */

require("dotenv").config();
const express = require("express");
const { ejecutarCicloConLock, getLeadsEnCurso, procesarMensajeEntrante, _obtenerDetallesCiclos } = require("../agentes/ciclo_supervisor");
const { clasificarEtapaAutomatica } = require("../agentes/clasificador_etapa");
const { generarReporteTexto } = require("./reportes/reporte_gerencial");
const kommo = require("./kommo");
const evolution = require("./evolution");
const config = require("./config");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const WA_DUENO = process.env.WA_DUENO_360;

let ultimoReporte = null;

// Buffer de los últimos webhooks recibidos (para diagnóstico)
const ULTIMOS_WEBHOOKS = [];
const WEBHOOK_BUFFER_MAX = 20;
const SERVER_STARTED_AT = new Date().toISOString();

// ─── Health check ─────────────────────────────────────────────────────────

app.get("/status", (_, res) => {
  const activos = getLeadsEnCurso();
  res.json({
    sistema: "360 Eventos",
    canal_whatsapp: config.whatsapp.numero,
    pipeline_kommo: config.kommo.pipelineId,
    estado: activos > 0 ? "ejecutando_ciclo" : "listo",
    ciclos_activos: activos,
    ultimo_ciclo: ultimoReporte?.timestamp || null,
    ultimo_enviados: ultimoReporte?.mensajes_enviados || 0,
    ultimo_escalados: ultimoReporte?.escalados_humano || 0,
  });
});

// ─── Trigger ciclo desde n8n ──────────────────────────────────────────────
// POST ?lead_id=X   → ciclo inmediato para ese lead (lock por lead)
// POST ?barrido=true → ciclo completo + resumen ejecutivo (barrido diario 9 AM)
// Sin params        → ciclo normal, sin resumen

app.post("/ciclo", async (req, res) => {
  const triggerLeadId = req.query.lead_id || null;
  const enviarResumen = req.query.barrido === "true";

  // El lock es por lead — responde inmediatamente y procesa en paralelo
  res.json({ status: "iniciado", trigger: triggerLeadId || (enviarResumen ? "barrido_diario" : "programado") });

  try {
    const reporte = await ejecutarCicloConLock(triggerLeadId, { enviarResumen });
    if (reporte) ultimoReporte = reporte;
  } catch (err) {
    console.error("[Servidor] Error en ciclo:", err.message);
  }
});

// ─── Webhook Evolution API — solo número 593980243197 ────────────────────

app.post("/webhook/360", async (req, res) => {
  // Responder inmediatamente a Evolution API (timeout < 5s)
  res.sendStatus(200);

  const payload = req.body;

  // Guardar en buffer para diagnóstico (sin secretos)
  ULTIMOS_WEBHOOKS.unshift({
    recibido_en: new Date().toISOString(),
    event: payload?.event,
    instance: payload?.instance,
    fromMe: payload?.data?.key?.fromMe,
    remoteJid: payload?.data?.key?.remoteJid,
    remoteJidAlt: payload?.data?.key?.remoteJidAlt,
    addressingMode: payload?.data?.key?.addressingMode,
    pushName: payload?.data?.pushName,
    text: (payload?.data?.message?.conversation || payload?.data?.message?.extendedTextMessage?.text || "").substring(0, 100),
    msgType: Object.keys(payload?.data?.message || {})[0] || null,
  });
  if (ULTIMOS_WEBHOOKS.length > WEBHOOK_BUFFER_MAX) ULTIMOS_WEBHOOKS.length = WEBHOOK_BUFFER_MAX;

  console.log(`[Webhook] event=${payload?.event} instance=${payload?.instance} jid=${payload?.data?.key?.remoteJid} alt=${payload?.data?.key?.remoteJidAlt}`);

  // Solo mensajes entrantes (Evolution puede usar "messages.upsert" o "MESSAGES_UPSERT")
  const evento = (payload?.event || "").toLowerCase().replace(/_/g, ".");
  if (evento !== "messages.upsert") {
    console.log(`[Webhook] Evento "${payload?.event}" no es messages.upsert — ignorando`);
    return;
  }

  try {
    await procesarMensajeEntrante(payload);
  } catch (err) {
    console.error("[Webhook] Error procesando mensaje:", err.message);
  }
});

// ─── Endpoint diagnóstico: ver últimos webhooks recibidos ─────────────────
app.get("/debug/webhooks", (_, res) => {
  res.json({
    deployed_commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || "unknown",
    server_started_at: SERVER_STARTED_AT,
    total_recibidos: ULTIMOS_WEBHOOKS.length,
    ultimos: ULTIMOS_WEBHOOKS,
  });
});

// ─── Endpoint diagnóstico: ver decisiones del último ciclo por lead ────────
app.get("/debug/last-ciclo", (_, res) => {
  res.json({
    server_started_at: SERVER_STARTED_AT,
    detalles: _obtenerDetallesCiclos(),
  });
});

// ─── Reporte último ciclo ─────────────────────────────────────────────────

app.get("/reporte", (_, res) => {
  if (!ultimoReporte) return res.json({ mensaje: "Sin reportes aún" });
  res.json(ultimoReporte);
});

// ─── Reporte gerencial → WhatsApp del dueño ───────────────────────────────
// POST /reporte-gerencial   (sin body necesario)
// Genera el reporte y lo manda al WA_DUENO_360.
app.post("/reporte-gerencial", async (req, res) => {
  res.json({ status: "iniciado", destino: WA_DUENO });
  if (!WA_DUENO) {
    console.error("[Reporte] WA_DUENO_360 no configurado en env");
    return;
  }
  try {
    const txt = await generarReporteTexto("wa");
    // WhatsApp tiene límite de ~4096 chars en un solo mensaje, partimos si excede
    if (txt.length <= 4000) {
      await evolution.enviarSistema(WA_DUENO, txt);
    } else {
      const partes = [];
      let actual = "";
      for (const linea of txt.split("\n")) {
        if ((actual + linea + "\n").length > 3800) {
          partes.push(actual);
          actual = "";
        }
        actual += linea + "\n";
      }
      if (actual.trim()) partes.push(actual);
      for (let i = 0; i < partes.length; i++) {
        await evolution.enviarSistema(
          WA_DUENO,
          `_(parte ${i + 1}/${partes.length})_\n\n${partes[i]}`
        );
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    console.log(`[Reporte] ✓ Enviado a ${WA_DUENO}`);
  } catch (err) {
    console.error("[Reporte] Error:", err.message);
  }
});

// ─── Debug por lead — requiere x-admin-token ─────────────────────────────────
// GET /debug/lead/:leadId
// Muestra el estado real del lead: etapa actual, etapa correcta, señales detectadas.

app.get("/debug/lead/:leadId", async (req, res) => {
  if (req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN) {
    return res.sendStatus(401);
  }

  const { leadId } = req.params;
  try {
    const lead = await kommo.obtenerLeadConTelefono(leadId);
    if (!lead) return res.status(404).json({ error: "Lead no encontrado" });

    const log = lead.log_wa || "";

    // Detectar señales desde el log
    function scanLog(keyword) {
      return log.split("\n").some((l) => l.includes("[BOT→") && l.includes(keyword));
    }
    const cuentaBancariaEnviada = scanLog("Erika Díaz") || scanLog("MARKETAS") || log.split("\n").some((l) => l.includes("[BOT→") && /\d{10,}/.test(l));

    let botFound = false;
    const clienteRespondioAlBot = log.split("\n").some((l) => {
      if (l.includes("[BOT→")) { botFound = true; return false; }
      return botFound && l.includes("[CLIENTE]");
    });

    // Calcular último mensaje de cada tipo
    const lineas = log.split("\n").filter(Boolean);
    const ultimoCliente = [...lineas].reverse().find((l) => l.includes("[CLIENTE]") || l.includes("[IN]")) || null;
    const ultimoBot = [...lineas].reverse().find((l) => l.includes("[BOT→")) || null;

    const etapaCorrecta = clasificarEtapaAutomatica({
      clienteRespondioAlBot,
      cuentaBancariaEnviada,
      etapaActual: lead.etapa_actual,
    });

    res.json({
      lead_id:                    Number(leadId),
      nombre:                     lead.nombre || null,
      telefono:                   lead.telefono || null,
      etapa_actual:               lead.etapa_actual,
      etapa_correcta:             etapaCorrecta,
      mal_clasificado:            etapaCorrecta !== lead.etapa_actual,
      senales: {
        cliente_respondio_al_bot: clienteRespondioAlBot,
        cuenta_bancaria_enviada:  cuentaBancariaEnviada,
      },
      ultimo_mensaje_cliente:     ultimoCliente,
      ultimo_mensaje_bot:         ultimoBot,
      pausar_ia:                  lead.pausar_ia || false,
    });
  } catch (err) {
    console.error("[Debug] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ Servidor 360 Eventos corriendo en puerto ${PORT}`);
  console.log(`📱 Canal WhatsApp: ${config.whatsapp.numero}`);
  console.log(`📊 Pipeline Kommo: ${config.kommo.pipelineId || "⚠️  sin configurar"}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /status            → Estado del sistema`);
  console.log(`  POST /ciclo             → Disparar ciclo supervisor`);
  console.log(`  POST /webhook/360       → Webhook Evolution API`);
  console.log(`  GET  /reporte           → Último reporte`);
  console.log(`  POST /reporte-gerencial → Genera y envía reporte al WA del dueño\n`);
});
// Fri May 15 00:44:01 -05 2026
