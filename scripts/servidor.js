/**
 * Servidor Express — Sistema 360 Eventos
 *
 * Recibe webhooks de Evolution API (número 593980243197)
 * y triggers de n8n para el ciclo del supervisor.
 */

require("dotenv").config();
const express = require("express");
const { ejecutarCiclo, procesarMensajeEntrante } = require("../agentes/ciclo_supervisor");
const config = require("./config");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

let cicloEnCurso = false;
let ultimoReporte = null;

// ─── Health check ─────────────────────────────────────────────────────────

app.get("/status", (_, res) => {
  res.json({
    sistema: "360 Eventos",
    canal_whatsapp: config.whatsapp.numero,
    pipeline_kommo: config.kommo.pipelineId,
    estado: cicloEnCurso ? "ejecutando_ciclo" : "listo",
    ultimo_ciclo: ultimoReporte?.timestamp || null,
    ultimo_enviados: ultimoReporte?.mensajes_enviados || 0,
    ultimo_escalados: ultimoReporte?.escalados_humano || 0,
  });
});

// ─── Trigger ciclo desde n8n (CRON cada 20 min) ───────────────────────────

app.post("/ciclo", async (req, res) => {
  const triggerLeadId = req.query.lead_id || null;

  if (cicloEnCurso) {
    return res.json({ status: "en_curso", mensaje: "Ya hay un ciclo ejecutándose" });
  }

  res.json({ status: "iniciado", trigger: triggerLeadId || "programado" });

  cicloEnCurso = true;
  try {
    ultimoReporte = await ejecutarCiclo(triggerLeadId);
  } catch (err) {
    console.error("[Servidor] Error en ciclo:", err.message);
  } finally {
    cicloEnCurso = false;
  }
});

// ─── Webhook Evolution API — solo número 593980243197 ────────────────────

app.post("/webhook/360", async (req, res) => {
  // Responder inmediatamente a Evolution API (timeout < 5s)
  res.sendStatus(200);

  const payload = req.body;

  // Solo mensajes de texto entrantes (no de estado, no de grupos)
  const evento = payload?.event;
  if (evento !== "messages.upsert") return;

  try {
    await procesarMensajeEntrante(payload);
  } catch (err) {
    console.error("[Webhook] Error procesando mensaje:", err.message);
  }
});

// ─── Reporte último ciclo ─────────────────────────────────────────────────

app.get("/reporte", (_, res) => {
  if (!ultimoReporte) return res.json({ mensaje: "Sin reportes aún" });
  res.json(ultimoReporte);
});

app.listen(PORT, () => {
  console.log(`\n✅ Servidor 360 Eventos corriendo en puerto ${PORT}`);
  console.log(`📱 Canal WhatsApp: ${config.whatsapp.numero}`);
  console.log(`📊 Pipeline Kommo: ${config.kommo.pipelineId || "⚠️  sin configurar"}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /status      → Estado del sistema`);
  console.log(`  POST /ciclo       → Disparar ciclo supervisor`);
  console.log(`  POST /webhook/360 → Webhook Evolution API`);
  console.log(`  GET  /reporte     → Último reporte\n`);
});
