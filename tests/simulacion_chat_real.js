/**
 * Simulación A/B: toma conversaciones reales de Kommo, re-procesa solo los
 * mensajes del cliente con el bot ACTUAL, y genera un HTML side-by-side
 * comparando lo que pasó (original) vs lo que pasaría hoy (simulado).
 *
 * Reglas:
 * - Solo se inyectan los INs del cliente al bot
 * - El bot genera sus respuestas naturalmente (supervisor → agente → QA)
 * - NO se envía nada a Evolution/WhatsApp real
 * - NO se actualiza Kommo
 */
require("dotenv").config({ path: __dirname + "/../.env" });
const fs = require("fs");
const path = require("path");
const { generarMensaje } = require("../agentes/agentes_etapa");
const { revisarMensaje } = require("../agentes/agente_qa");
const { evaluarLead } = require("../agentes/supervisor");

const KOMMO_BASE = "https://marketas.kommo.com/api/v4";
const KOMMO_HEADERS = { Authorization: "Bearer " + process.env.KOMMO_ACCESS_TOKEN };
const MAX_QA = 3;

// Leads a analizar
const LEADS = [
  { id: "21318225", nombre: "Sandra", tel: "593990279954" },
  { id: "21288753", nombre: "Gladys", tel: "593985465422" },
  { id: "21318153", nombre: "Kary", tel: "593958686561" },
  { id: "21318067", nombre: "Maribel Adriana", tel: "593987138015" },
];

// ─── 1. Fetch log_wa de Kommo y parsear ─────────────────────────────────────
async function obtenerLogWa(leadId) {
  const r = await fetch(KOMMO_BASE + "/leads/" + leadId + "?with=custom_fields_values", { headers: KOMMO_HEADERS });
  const data = await r.json();
  const logField = data.custom_fields_values?.find((c) => c.field_id === 1158003);
  return {
    nombre: data.name,
    status_id: data.status_id,
    log_wa: logField?.values?.[0]?.value || "",
  };
}

// Parser de log_wa: extrae cliente messages y bot messages en orden cronológico
function parsearLog(logWa) {
  const lineas = logWa.split("\n").filter((l) => l.trim());
  const eventos = [];
  for (const linea of lineas) {
    // Cliente messages: [CLIENTE] o [IN]
    let m = linea.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?)\s*\[(CLIENTE|IN)\][^\]]*?\]?\s*(.+)$/);
    if (m) {
      eventos.push({
        ts: m[1].replace("T", " ").substring(0, 16),
        role: "cliente",
        texto: m[4].trim(),
      });
      continue;
    }
    // Variante [2026-05-19 03:58] [IN] ...
    m = linea.match(/^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\]\s+\[(CLIENTE|IN)\]\s+(.+)$/);
    if (m) {
      eventos.push({ ts: m[1], role: "cliente", texto: m[3].trim() });
      continue;
    }
    // Bot messages: [BOT→...]
    m = linea.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?)\s*\[BOT→([^\]]+)\]\s+(.+)$/);
    if (m) {
      eventos.push({
        ts: m[1].replace("T", " ").substring(0, 16),
        role: "bot",
        agente: m[3],
        texto: m[4].trim(),
      });
      continue;
    }
  }
  // Dedupe cliente messages que aparecen en ambos formatos [CLIENTE] y [IN]
  const dedupeado = [];
  for (const ev of eventos) {
    const ya = dedupeado.find((d) => d.ts === ev.ts && d.role === ev.role && d.texto === ev.texto);
    if (!ya) dedupeado.push(ev);
  }
  return dedupeado;
}

// ─── 2. Simular conversación con el bot actual ──────────────────────────────
async function simularConversacion(clientes, nombreLead) {
  const historial = [];
  const conversacion = [];
  let etapa = "contacto_inicial";
  let numSeg = 0;
  let precioCotizado = null;
  let nivelNeg = 0;

  for (const msgCliente of clientes) {
    // Agregar mensaje cliente al historial + conversación
    historial.push({ role: "lead", content: msgCliente.texto, timestamp: msgCliente.ts });
    conversacion.push({ role: "cliente", ts: msgCliente.ts, texto: msgCliente.texto });

    // Construir contexto
    const contexto = {
      lead_id: 90000,
      nombre: nombreLead,
      etapa_actual: etapa,
      ultimo_mensaje_cliente: msgCliente.texto,
      conversacion: {
        ultimo_mensaje_cliente: msgCliente.texto,
        num_seguimientos_enviados: numSeg,
        tono_cliente: "interesado",
        ultimo_mensaje_bot: historial.filter((m) => m.role !== "lead").pop()?.content || "",
      },
      datos_evento: { tipo: null, fecha: null, lugar: null },
      comercial: { precio_cotizado: precioCotizado, nivel_negociacion_actual: nivelNeg },
      alertas: [],
      tono_cliente: "interesado",
      nivel_negociacion: nivelNeg,
      resumen_conversacion: historial.slice(-6).map((m) => `${m.role === "lead" ? "CLIENTE" : "BOT"}: ${m.content}`).join("\n"),
    };
    const lead = {
      id: 90000, nombre: nombreLead, telefono: "593XXXXXXXXX",
      etapa_actual: etapa, contexto,
      historial: [...historial],
      log_wa: "",
    };

    // Supervisor
    let decision;
    try {
      decision = await evaluarLead(lead);
    } catch (e) {
      conversacion.push({ role: "error", ts: msgCliente.ts, texto: "(Supervisor error: " + e.message + ")" });
      continue;
    }

    if (decision.accion === "esperar" || decision.agente_destino === "humano" || decision.accion === "escalar") {
      const etiqueta = decision.agente_destino === "humano" ? "ESCALADO A HUMANO" : "BOT ESPERA";
      conversacion.push({ role: "bot_meta", ts: msgCliente.ts, texto: `(${etiqueta}: ${decision.razon_decision || "sin razón"})` });
      if (decision.nueva_etapa) etapa = decision.nueva_etapa;
      continue;
    }

    // Override boda/quinceaños — replicado del ciclo_supervisor.js
    const ultMsg = msgCliente.texto.toLowerCase();
    const histRec = historial.filter((m) => m.role === "lead").slice(-3).map((m) => m.content.toLowerCase()).join(" ");
    const textoBusqueda = ultMsg + " " + histRec;
    const detectaBoda = /\b(boda|casamiento|matrimonio|me caso)\b/.test(textoBusqueda);
    const detectaQuince = /\b(quincea(?:ñ|n)os?|quincea(?:ñ|n)era|15 a(?:ñ|n)os|de los 15)\b/.test(textoBusqueda);
    const clienteRechazoPaquete = /\b(solo|nada m[aá]s|únicamente)\s+(el\s+)?(360|video(?:booth)?|photo(?:booth)?|fotos?|niebla|pirotecnia)\b/.test(histRec);

    if ((detectaBoda || detectaQuince) && !precioCotizado && !clienteRechazoPaquete) {
      const esBoda = detectaBoda;
      const tipoLabel = esBoda ? "boda" : "quinceaños";
      const tipoTitulo = esBoda ? "Boda" : "Quinceaños";
      const emoji = esBoda ? "💍" : "👑";
      const felicitacion = esBoda ? "¡Felicidades por tu boda" : "¡Qué bueno, los 15 años";
      const provincias = ["latacunga","otavalo","ibarra","cayambe","cotacachi","tabacundo","machachi","salcedo","mindo","papallacta","baeza","los bancos","nanegalito","aloag"];
      let lugarDet = null;
      for (const p of provincias) if (textoBusqueda.includes(p)) { lugarDet = p[0].toUpperCase() + p.slice(1); break; }
      const lugarSaludo = lugarDet ? ` en ${lugarDet}` : "";
      const lugarLinea = lugarDet ? `\n🚐 *Cobertura ${lugarDet} incluida*` : "";
      const detectaFecha = /\b\d{1,2}\s*(de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i.test(textoBusqueda);
      const preguntaFinal = detectaFecha ? "*¿Lo aseguramos?*" : "*¿Para qué fecha es?*";
      decision.instruccion_agente = `OVERRIDE DETERMINISTA — Cliente confirmó ${tipoLabel}${lugarDet?" en "+lugarDet:""}. Genera EXACTAMENTE este mensaje (copia palabra por palabra):\n\n${felicitacion}${lugarSaludo} ${emoji}! Te recomiendo el *Paquete ${tipoTitulo} Completo*:\n✅ *1h VideoBooth 360*\n✅ *1h PhotoBooth*\n✅ *Niebla baja + 2 pirotecnia frías*${lugarLinea}\n\n***Total: $320*** *(ahorras $40 vs separado)*\n\n${preguntaFinal}`;
    }

    // Override primer contacto si es el primer mensaje
    if (numSeg === 0 && historial.filter((m) => m.role !== "lead").length === 0) {
      const ultMsgLower = msgCliente.texto.toLowerCase();
      let templateName = "GENERAL";
      if (/360|videobooth|video.?360|plataforma|slow.?motion|video/.test(ultMsgLower)) templateName = "360";
      else if (/photobooth|photo.?booth|fotos|fotograf|impresi/.test(ultMsgLower)) templateName = "PHOTOBOOTH";
      else if (/niebla|pirotecnia|fuegos|cartuchos|vals|efectos/.test(ultMsgLower)) templateName = "NIEBLA_PIROTECNIA";
      if (!decision.instruccion_agente.toLowerCase().includes("override determinista")) {
        decision.instruccion_agente = `Primer contacto proactivo — usa EXACTAMENTE el TEMPLATE ${templateName} del agente_ventas (sección PRIMER CONTACTO PROACTIVO). No improvises, no resumas, no cambies nada.`;
      }
    }

    // Agente + QA loop
    let mensajeFinal = null;
    let intentos = 0;
    let ultimaCorr = null;
    while (intentos < MAX_QA && !mensajeFinal) {
      intentos++;
      const instr = ultimaCorr ? `${decision.instruccion_agente}\n\nCORRECCIÓN QA: ${ultimaCorr}` : decision.instruccion_agente;
      try {
        const borrador = await generarMensaje(decision.agente_destino, contexto, instr, historial);
        const rev = await revisarMensaje(borrador, contexto, historial, decision.instruccion_agente);
        if (rev.decision === "APRUEBA") {
          mensajeFinal = rev.mensaje_final;
        } else {
          ultimaCorr = rev.correcciones_sugeridas || rev.razones?.join(";") || "";
        }
      } catch (e) {
        ultimaCorr = "Error: " + e.message;
      }
    }

    if (!mensajeFinal) {
      // Fallback contextual
      mensajeFinal = `Hola, gracias por escribirnos. Te paso info en seguida. *¿Para qué tipo de evento sería?*`;
      conversacion.push({ role: "bot_fallback", ts: msgCliente.ts, texto: mensajeFinal });
    } else {
      conversacion.push({ role: "bot", ts: msgCliente.ts, agente: decision.agente_destino, texto: mensajeFinal });
    }

    historial.push({ role: "bot", content: mensajeFinal, timestamp: msgCliente.ts });
    if (["contacto_inicial","seguimiento","negociacion"].includes(decision.agente_destino)) numSeg++;
    if (decision.nueva_etapa) etapa = decision.nueva_etapa;
  }

  return conversacion;
}

// ─── 3. HTML generation ─────────────────────────────────────────────────────
function generarHtml(reporte) {
  const escape = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const formatMsg = (s) => escape(s).replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/\n/g, "<br>");

  const renderConv = (mensajes) => mensajes.map((m) => {
    let claseBubble, etiqueta;
    if (m.role === "cliente") { claseBubble = "cliente"; etiqueta = "Cliente"; }
    else if (m.role === "bot") { claseBubble = "bot"; etiqueta = "Bot ["+(m.agente||"?")+"]"; }
    else if (m.role === "bot_fallback") { claseBubble = "bot fallback"; etiqueta = "Bot [FALLBACK]"; }
    else if (m.role === "bot_meta") { claseBubble = "meta"; etiqueta = "Sistema"; }
    else if (m.role === "error") { claseBubble = "meta error"; etiqueta = "Error"; }
    else { claseBubble = "meta"; etiqueta = m.role; }
    return `<div class="msg ${claseBubble}">
      <div class="meta-info"><span class="ts">${escape(m.ts)}</span><span class="lbl">${etiqueta}</span></div>
      <div class="bubble">${formatMsg(m.texto)}</div>
    </div>`;
  }).join("");

  const leadsHtml = reporte.map((r) => `
    <section class="lead">
      <h2>${escape(r.nombre)} — Lead #${escape(r.id)}</h2>
      <div class="cols">
        <div class="col">
          <h3 class="orig-title">📜 ORIGINAL (lo que pasó)</h3>
          <div class="chat">${renderConv(r.original)}</div>
          <p class="stats">${r.original.filter(m=>m.role==="cliente").length} mensajes cliente · ${r.original.filter(m=>m.role==="bot").length} mensajes bot</p>
        </div>
        <div class="col">
          <h3 class="sim-title">🔮 SIMULADO (con prompt actual)</h3>
          <div class="chat">${renderConv(r.simulado)}</div>
          <p class="stats">${r.simulado.filter(m=>m.role==="cliente").length} mensajes cliente · ${r.simulado.filter(m=>m.role.startsWith("bot")).length} respuestas bot</p>
        </div>
      </div>
    </section>
  `).join("");

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Simulación A/B — Bot 360 Eventos</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Helvetica, sans-serif; background: #ece5dd; margin: 0; padding: 20px; }
  header { background: #075e54; color: white; padding: 15px 25px; border-radius: 8px; margin-bottom: 20px; }
  header h1 { margin: 0; font-size: 22px; }
  header .sub { font-size: 13px; opacity: 0.85; margin-top: 4px; }
  .lead { background: white; border-radius: 8px; margin-bottom: 25px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  .lead h2 { margin: 0 0 15px 0; color: #075e54; padding-bottom: 8px; border-bottom: 2px solid #25d366; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
  .col { background: #f5f5f5; border-radius: 6px; padding: 12px; }
  .col h3 { margin: 0 0 10px 0; font-size: 14px; padding: 6px 10px; border-radius: 4px; }
  .orig-title { background: #fce4e4; color: #b71c1c; }
  .sim-title { background: #e8f5e9; color: #1b5e20; }
  .chat { display: flex; flex-direction: column; gap: 6px; max-height: 600px; overflow-y: auto; padding: 5px; }
  .msg { display: flex; flex-direction: column; max-width: 85%; }
  .msg.cliente { align-self: flex-start; }
  .msg.bot, .msg.bot_fallback, .msg.bot_meta { align-self: flex-end; }
  .meta-info { display: flex; gap: 8px; font-size: 10px; color: #999; padding: 0 4px 2px; }
  .meta-info .lbl { font-weight: 600; }
  .msg.cliente .bubble { background: white; border-radius: 0 8px 8px 8px; padding: 8px 12px; font-size: 13px; line-height: 1.4; }
  .msg.bot .bubble { background: #dcf8c6; border-radius: 8px 0 8px 8px; padding: 8px 12px; font-size: 13px; line-height: 1.4; }
  .msg.bot.fallback .bubble { background: #ffe082; }
  .msg.meta .bubble, .msg.meta.error .bubble { background: #e0e0e0; color: #555; font-style: italic; border-radius: 4px; padding: 6px 10px; font-size: 11px; align-self: center; }
  .msg.meta.error .bubble { background: #ffcdd2; color: #b71c1c; }
  .stats { margin: 8px 0 0; font-size: 11px; color: #666; text-align: center; }
  b { font-weight: 700; }
</style></head>
<body>
<header>
  <h1>🤖 Simulación A/B — Bot 360 Eventos</h1>
  <div class="sub">Comparativo: lo que pasó (Original) vs lo que respondería el bot con el prompt actual (Simulado)</div>
  <div class="sub">Generado: ${new Date().toLocaleString("es-EC")}</div>
</header>
${leadsHtml}
</body></html>`;
}

// ─── 4. Main ────────────────────────────────────────────────────────────────
(async () => {
  console.log("═".repeat(70));
  console.log("  SIMULACIÓN A/B — Bot 360 Eventos");
  console.log("═".repeat(70));

  const reporte = [];
  for (const lead of LEADS) {
    console.log(`\n[${lead.nombre} #${lead.id}] obteniendo log...`);
    const { nombre, log_wa } = await obtenerLogWa(lead.id);
    const eventos = parsearLog(log_wa);
    const cliMessages = eventos.filter((e) => e.role === "cliente");
    console.log(`  ${cliMessages.length} mensajes del cliente identificados`);

    // ORIGINAL = todos los eventos en orden
    const original = eventos.map((e) => {
      if (e.role === "cliente") return { role: "cliente", ts: e.ts, texto: e.texto };
      if (e.role === "bot") {
        // Detectar fallback (textos genéricos)
        const esFallback = /(te escribimos de 360 eventos|tenemos el videobooth 360 para hacer tu evento memorable)/i.test(e.texto);
        return { role: esFallback ? "bot_fallback" : "bot", ts: e.ts, agente: e.agente, texto: e.texto };
      }
      return null;
    }).filter(Boolean);

    // SIMULADO = re-procesar solo cliente messages
    console.log(`  Simulando con bot actual...`);
    const simulado = await simularConversacion(cliMessages, lead.nombre);
    console.log(`  ✓ ${simulado.filter((m) => m.role.startsWith("bot")).length} respuestas generadas`);

    reporte.push({ id: lead.id, nombre: lead.nombre, original, simulado });
  }

  const html = generarHtml(reporte);
  const outPath = path.join(__dirname, "simulacion_chat.html");
  fs.writeFileSync(outPath, html);
  console.log(`\n✅ HTML generado: ${outPath}`);
  console.log(`   Abrir con: open ${outPath}`);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
