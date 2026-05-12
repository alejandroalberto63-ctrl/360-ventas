#!/usr/bin/env node
/**
 * Reporte Gerencial 360 Eventos
 *
 * Genera un resumen ejecutivo del estado del embudo:
 *  - Estado del embudo (leads por etapa)
 *  - Actividad del día (mensajes, cierres, videos)
 *  - Potenciales compradores identificados
 *  - Salud del sistema
 *
 * Exporta:
 *   generarReporteTexto(modo) → Promise<string>   modo: 'wa' (whatsapp) o 'console'
 *
 * Uso CLI:
 *   node scripts/reportes/reporte_gerencial.js
 */

require("dotenv").config();

const BASE = "https://marketas.amocrm.com/api/v4";
const TOKEN = process.env.KOMMO_ACCESS_TOKEN;
const headers = () => ({ Authorization: `Bearer ${TOKEN}` });

const ETAPAS = {
  68329668: "contacto_inicial",
  68329672: "negociacion",
  68659032: "seguimiento",
  78232224: "reserva",
  142: "ganado",
  143: "perdido",
};

async function todosLeadsPipeline() {
  const all = [];
  for (let page = 1; page <= 15; page++) {
    const url = new URL(`${BASE}/leads`);
    url.searchParams.set("filter[pipeline_id]", "8699516");
    url.searchParams.set("with", "contacts");
    url.searchParams.set("limit", "250");
    url.searchParams.set("page", page);
    const r = await fetch(url, { headers: headers() });
    if (!r.ok) break;
    const t = await r.text();
    if (!t.trim()) break;
    try {
      const d = JSON.parse(t);
      const ls = d._embedded?.leads || [];
      if (!ls.length) break;
      all.push(...ls);
    } catch (e) {
      continue;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return all;
}

function inicioHoyEcuadorMs() {
  const ahora = new Date();
  const ecOffsetMs = 5 * 60 * 60 * 1000;
  const ahoraEC = new Date(ahora.getTime() - ecOffsetMs);
  ahoraEC.setUTCHours(0, 0, 0, 0);
  return ahoraEC.getTime() + ecOffsetMs;
}

async function generarReporteTexto(modo = "wa") {
  const wa = modo === "wa";
  const L = []; // líneas

  const fechaHoy = new Date().toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
    dateStyle: "full",
    timeStyle: "short",
  });

  if (wa) {
    L.push(`*📊 REPORTE GERENCIAL 360 EVENTOS*`);
    L.push(`_${fechaHoy}_`);
    L.push("");
  } else {
    L.push("╔═══════════════════════════════════════════════════════════╗");
    L.push("║         REPORTE GERENCIAL 360 EVENTOS                     ║");
    L.push(`║  ${fechaHoy.padEnd(57)}║`);
    L.push("╚═══════════════════════════════════════════════════════════╝");
    L.push("");
  }

  const leads = await todosLeadsPipeline();

  // ─── 1. EMBUDO ──────────────────────────────────────────────────────
  const porEtapa = {};
  for (const l of leads) {
    const e = ETAPAS[l.status_id] || "desconocida";
    porEtapa[e] = (porEtapa[e] || 0) + 1;
  }
  const activos =
    (porEtapa.contacto_inicial || 0) +
    (porEtapa.seguimiento || 0) +
    (porEtapa.negociacion || 0);

  if (wa) {
    L.push(`*━━━ EMBUDO ━━━*`);
    L.push(`📥 Contacto Inicial: *${porEtapa.contacto_inicial || 0}*`);
    L.push(`🔄 Seguimiento: *${porEtapa.seguimiento || 0}*`);
    L.push(`💼 Negociación: *${porEtapa.negociacion || 0}*`);
    L.push(`✅ Reserva: *${porEtapa.reserva || 0}*`);
    L.push(`🏆 Ganados: *${porEtapa.ganado || 0}*`);
    L.push(`❌ Perdidos (histórico): *${porEtapa.perdido || 0}*`);
    L.push(`📈 *TOTAL ACTIVOS: ${activos}*`);
    L.push("");
  } else {
    L.push("━━━ ESTADO DEL EMBUDO ━━━");
    const etapasOrden = ["contacto_inicial", "seguimiento", "negociacion", "reserva", "ganado", "perdido"];
    for (const e of etapasOrden) {
      const n = porEtapa[e] || 0;
      const bar = "█".repeat(Math.min(Math.round(n / 5), 40));
      L.push(`  ${e.padEnd(18)} ${String(n).padStart(4)}  ${bar}`);
    }
    L.push(`  ${"─".repeat(50)}`);
    L.push(`  ${"ACTIVOS".padEnd(18)} ${String(activos).padStart(4)}`);
    L.push("");
  }

  // ─── 2. ACTIVIDAD DEL DÍA ───────────────────────────────────────────
  const inicioHoy = inicioHoyEcuadorMs();
  const inicioHoySec = Math.floor(inicioHoy / 1000);

  let cerradosHoy = 0;
  let cerradosAutoHoy = 0;
  let videosHoy = 0;
  let mensajesBotHoy = 0;
  let mensajesClienteHoy = 0;
  let leadsConActividadHoy = 0;

  for (const l of leads) {
    if (l.status_id !== 143 && l.status_id !== 142) continue;
    if (l.updated_at >= inicioHoySec) cerradosHoy++;
  }

  const conLog = leads.filter((l) => {
    const cf = (l.custom_fields_values || []).find((c) => c.field_id === 1158003);
    return cf && cf.values?.[0]?.value;
  });
  for (const l of conLog) {
    const log = l.custom_fields_values.find((c) => c.field_id === 1158003).values[0].value;
    const lineasHoy = log.split("\n").filter((linea) => {
      const m = linea.match(/(\d{4}-\d{2}-\d{2})/);
      if (!m) return false;
      const fechaLinea = new Date(m[1] + "T00:00:00-05:00").getTime();
      return fechaLinea >= inicioHoy - 12 * 3600 * 1000;
    });
    let huboActividad = false;
    for (const linea of lineasHoy) {
      if (linea.includes("[BOT→")) {
        mensajesBotHoy++;
        huboActividad = true;
        if (linea.includes("[BOT→video]")) videosHoy++;
      }
      if (linea.includes("[CLIENTE")) {
        mensajesClienteHoy++;
        huboActividad = true;
      }
      if (linea.includes("[SISTEMA-CIERRE]") || linea.includes("auto_perdido")) cerradosAutoHoy++;
    }
    if (huboActividad) leadsConActividadHoy++;
  }

  if (wa) {
    L.push(`*━━━ ACTIVIDAD HOY ━━━*`);
    L.push(`📤 Bot envió: *${mensajesBotHoy}* mensajes`);
    L.push(`📥 Clientes respondieron: *${mensajesClienteHoy}*`);
    L.push(`🎥 Videos demo: *${videosHoy}*`);
    L.push(`❌ Cerrados hoy: *${cerradosHoy}*`);
    if (cerradosAutoHoy > 0) L.push(`🤖 Auto-cierres bot: *${cerradosAutoHoy}*`);
    L.push(`💡 Leads con actividad: *${leadsConActividadHoy}*`);
    L.push("");
  } else {
    L.push("━━━ ACTIVIDAD DEL DÍA ━━━");
    L.push(`  Mensajes enviados por el bot:        ${mensajesBotHoy}`);
    L.push(`  Mensajes recibidos de clientes:      ${mensajesClienteHoy}`);
    L.push(`  Videos demo enviados:                ${videosHoy}`);
    L.push(`  Leads cerrados como perdido (hoy):   ${cerradosHoy}`);
    L.push(`  Cierres automáticos:                 ${cerradosAutoHoy}`);
    L.push(`  Leads con cualquier actividad:       ${leadsConActividadHoy}`);
    L.push("");
  }

  // ─── 3. POTENCIALES COMPRADORES ─────────────────────────────────────
  const negociacionAlta = leads
    .filter((l) => l.status_id === 68329672)
    .map((l) => {
      const log = (l.custom_fields_values || []).find((c) => c.field_id === 1158003)?.values?.[0]?.value || "";
      const ms = log.match(/neg:(\d)/g) || [];
      const ultNeg = ms.length ? Number(ms[ms.length - 1].match(/\d/)) : 0;
      const precioMs = log.match(/precio:(\d+)/g) || [];
      const precio = precioMs.length ? precioMs[precioMs.length - 1].replace("precio:", "") : null;
      return { id: l.id, nombre: l.name, nivel: ultNeg, precio };
    })
    .filter((x) => x.nivel >= 2)
    .sort((a, b) => b.nivel - a.nivel);

  const conEspera = leads
    .filter((l) => l.status_id !== 142 && l.status_id !== 143)
    .map((l) => {
      const log = (l.custom_fields_values || []).find((c) => c.field_id === 1158003)?.values?.[0]?.value || "";
      const esp = log.match(/espera:(cliente_avisara|reunion_programada):(\d{4}-\d{2}-\d{2})/g) || [];
      if (!esp.length) return null;
      const ultima = esp[esp.length - 1];
      const m = ultima.match(/espera:(\w+):(\d{4}-\d{2}-\d{2})/);
      return m ? { id: l.id, nombre: l.name, tipo: m[1], fecha: m[2] } : null;
    })
    .filter(Boolean);

  const respondieronHoy = conLog.filter((l) => {
    const log = l.custom_fields_values.find((c) => c.field_id === 1158003).values[0].value;
    const ult = log.split("\n").reverse().find((x) => x.includes("[CLIENTE"));
    if (!ult) return false;
    const m = ult.match(/(\d{4}-\d{2}-\d{2})/);
    if (!m) return false;
    return new Date(m[1] + "T00:00:00-05:00").getTime() >= inicioHoy - 12 * 3600 * 1000;
  });

  if (wa) {
    L.push(`*━━━ POTENCIALES COMPRADORES ━━━*`);
    L.push(`🔥 Negociación nivel 2+: *${negociacionAlta.length}*`);
    for (const p of negociacionAlta.slice(0, 5)) {
      L.push(`   • #${p.id} ${(p.nombre || "?").substring(0, 20)} (nivel ${p.nivel}, $${p.precio || "?"})`);
    }
    L.push(`⏳ En espera con fecha: *${conEspera.length}*`);
    for (const p of conEspera.slice(0, 5)) {
      L.push(`   • #${p.id} ${(p.nombre || "?").substring(0, 20)} (${p.tipo}, ${p.fecha})`);
    }
    L.push(`💬 Respondieron hoy: *${respondieronHoy.length}*`);
    L.push("");
  } else {
    L.push("━━━ POTENCIALES COMPRADORES (alta intención) ━━━");
    L.push(`\n  🔥 NEGOCIACIÓN AVANZADA (nivel 2+): ${negociacionAlta.length} leads`);
    for (const p of negociacionAlta.slice(0, 10)) {
      L.push(`     #${p.id} | ${(p.nombre || "?").substring(0, 25).padEnd(25)} | nivel=${p.nivel} | precio=$${p.precio || "?"}`);
    }
    L.push(`\n  ⏳ EN ESPERA (cliente avisará o reunión): ${conEspera.length} leads`);
    for (const p of conEspera.slice(0, 10)) {
      L.push(`     #${p.id} | ${(p.nombre || "?").substring(0, 25).padEnd(25)} | ${p.tipo} | retomar ${p.fecha}`);
    }
    L.push(`\n  💬 RESPONDIERON HOY: ${respondieronHoy.length} leads (probable interés activo)`);
    L.push("");
  }

  // ─── 4. SALUD DEL SISTEMA ───────────────────────────────────────────
  try {
    const r = await fetch("https://marketa-360-ventas.hoqkyr.easypanel.host/status");
    const j = await r.json();
    const r2 = await fetch("https://marketa-360-ventas.hoqkyr.easypanel.host/reporte");
    const j2 = await r2.json();

    if (wa) {
      L.push(`*━━━ SISTEMA ━━━*`);
      L.push(`⚙️ Estado: *${j.estado}*`);
      if (j.ultimo_ciclo) {
        const fc = new Date(j.ultimo_ciclo).toLocaleString("es-EC", {
          timeZone: "America/Guayaquil",
          timeStyle: "short",
        });
        L.push(`🕐 Último ciclo: ${fc}`);
        L.push(`   Enviados: ${j.ultimo_enviados} | Escalados: ${j.ultimo_escalados}`);
      } else {
        L.push(`🕐 Último ciclo: _ninguno aún_`);
      }
      if (j2 && j2.duracion_ms) {
        const ahorro = j2.contextos_sinteticos > 0
          ? Math.round((j2.contextos_sinteticos * 100) / (j2.contextos_con_llm + j2.contextos_sinteticos))
          : 0;
        L.push(`⚡ Ahorro OpenAI por memoria: *${ahorro}%*`);
      }
    } else {
      L.push("━━━ SALUD DEL SISTEMA ━━━");
      L.push(`  Node.js estado:           ${j.estado}`);
      L.push(`  Último ciclo:             ${j.ultimo_ciclo || "ninguno aún"}`);
      L.push(`  Mensajes último ciclo:    ${j.ultimo_enviados ?? "—"}`);
      L.push(`  Escalados último:         ${j.ultimo_escalados ?? "—"}`);
      if (j2 && j2.duracion_ms) {
        L.push(`  Duración último ciclo:    ${(j2.duracion_ms / 1000).toFixed(1)}s`);
        L.push(`  Contextos LLM/sintéticos: ${j2.contextos_con_llm}/${j2.contextos_sinteticos}`);
      }
    }
  } catch (e) {
    L.push(`⚠️ No se pudo consultar Node.js: ${e.message}`);
  }

  return L.join("\n");
}

module.exports = { generarReporteTexto };

// Si se ejecuta directo en CLI
if (require.main === module) {
  (async () => {
    const txt = await generarReporteTexto("console");
    console.log(txt);
  })().catch((e) => {
    console.error("FATAL:", e.message);
    process.exit(1);
  });
}
