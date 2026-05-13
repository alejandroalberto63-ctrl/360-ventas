/**
 * Servidor Express — Sistema 360 Eventos
 *
 * Recibe webhooks de Evolution API (número 593980243197)
 * y triggers de n8n para el ciclo del supervisor.
 */

require("dotenv").config();
const express = require("express");
const { ejecutarCiclo, procesarMensajeEntrante } = require("../agentes/ciclo_supervisor");
const { generarReporteTexto } = require("./reportes/reporte_gerencial");
const evolution = require("./evolution");
const config = require("./config");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const WA_DUENO = process.env.WA_DUENO_360;

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

// ─── Trigger ciclo desde n8n ──────────────────────────────────────────────
// GET ?lead_id=X   → ciclo inmediato para ese lead (webhook entrante)
// GET ?barrido=true → ciclo completo + resumen ejecutivo (barrido diario 9 AM)
// Sin params       → ciclo normal cada 5 min, sin resumen

app.post("/ciclo", async (req, res) => {
  const triggerLeadId = req.query.lead_id  || null;
  const enviarResumen = req.query.barrido  === "true";

  if (cicloEnCurso) {
    return res.json({ status: "en_curso", mensaje: "Ya hay un ciclo ejecutándose" });
  }

  res.json({ status: "iniciado", trigger: triggerLeadId || (enviarResumen ? "barrido_diario" : "programado") });

  cicloEnCurso = true;
  try {
    ultimoReporte = await ejecutarCiclo(triggerLeadId, { enviarResumen });
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
