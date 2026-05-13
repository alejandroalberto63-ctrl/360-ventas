/**
 * Ciclo del Supervisor — 360 Eventos
 *
 * Orquestador principal. Llamado por n8n cada 20 minutos
 * o inmediatamente cuando llega un mensaje al número 593980243197.
 *
 * Solo opera sobre el pipeline 360 en Kommo.
 * Canal ventas (clientes):  593980243197 — instancia 360eventos
 * Canal sistema (alertas):  593987841594 — instancia marketa_system
 */

const { extraerContexto } = require("./agente_contexto");
const { generarMensaje } = require("./agentes_etapa");
const { revisarMensaje } = require("./agente_qa");
const { evaluarLead } = require("./supervisor");
const { llamarConImagen, transcribirAudio, resetUsage, getUsage, calcularCostoUSD } = require("./openai_client");
const kommo = require("../scripts/kommo");
const evolution = require("../scripts/evolution");
const config = require("../scripts/config");

const MAX_REINTENTOS_QA = config.supervisor.maxReintentosQA;

// Debounce: cuando un cliente envía varios mensajes seguidos, esperamos
// a que termine de escribir antes de disparar el ciclo. Cada mensaje nuevo
// reinicia el contador. Después de DEBOUNCE_MS sin nuevos mensajes → ciclo.
const DEBOUNCE_MS = 12000; // 12 segundos
const pendingTriggers = new Map(); // leadId -> { timer, lastMessageAt }

function programarCicloDebounced(leadId) {
  // Si ya había un timer pendiente para este lead, cancélalo
  const existing = pendingTriggers.get(String(leadId));
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(async () => {
    pendingTriggers.delete(String(leadId));
    console.log(`[Debounce] Disparando ciclo para lead ${leadId} (12s sin mensajes nuevos)`);
    try {
      await ejecutarCiclo(leadId);
    } catch (err) {
      console.error(`[Debounce] Error ejecutando ciclo para lead ${leadId}:`, err.message);
    }
  }, DEBOUNCE_MS);

  pendingTriggers.set(String(leadId), { timer, lastMessageAt: Date.now() });
  console.log(`[Debounce] Lead ${leadId} en espera (${DEBOUNCE_MS / 1000}s antes de procesar)`);
}

// ─── Ciclo Principal ─────────────────────────────────────────────────────────

async function ejecutarCiclo(triggerLeadId = null, { enviarResumen = false } = {}) {
  const inicio = Date.now();
  console.log(`\n${"═".repeat(60)}`);
  console.log(`[Supervisor 360] ${new Date().toISOString()}`);
  console.log(`[Canal] WhatsApp ${config.whatsapp.numero} | Pipeline: ${config.kommo.pipelineId}`);
  if (triggerLeadId) console.log(`[Trigger] Mensaje entrante → Lead ${triggerLeadId}`);
  console.log(`${"═".repeat(60)}\n`);

  // Resetear contador de tokens al inicio de cada ciclo
  resetUsage();

  const reporte = {
    timestamp: new Date().toISOString(),
    canal: config.whatsapp.numero,
    trigger: triggerLeadId ? "mensaje_entrante" : "barrido_diario",
    leads_revisados: 0,
    mensajes_enviados: 0,
    mensajes_rechazados_qa: 0,
    escalados_humano: 0,
    errores: [],
    detalle_acciones: [],
    por_etapa: {
      nuevo:            { total: 0, enviados: 0 },
      contacto_inicial: { total: 0, enviados: 0 },
      seguimiento:      { total: 0, enviados: 0 },
      negociacion:      { total: 0, enviados: 0 },
      reserva:          { total: 0, enviados: 0 },
    },
  };

  // Verificar conexión WhatsApp
  const conectado = await evolution.verificarConexion();
  if (!conectado) {
    console.error("[Supervisor] ❌ Instancia Evolution desconectada. Abortando ciclo.");
    reporte.errores.push({ etapa: "conexion_evolution", error: "Instancia desconectada" });
    return reporte;
  }

  // PASO 1: Obtener leads activos del pipeline 360 en Kommo
  let leads;
  try {
    leads = await kommo.obtenerLeadsActivos();
    // Si hay trigger, poner ese lead primero
    if (triggerLeadId) {
      leads.sort((a, b) => (String(a.id) === String(triggerLeadId) ? -1 : 1));
    }
    reporte.leads_revisados = leads.length;
    console.log(`[Kommo] Leads activos en pipeline 360: ${leads.length}`);
  } catch (err) {
    console.error("[Kommo] Error obteniendo leads:", err.message);
    reporte.errores.push({ etapa: "obtener_leads", error: err.message });
    return reporte;
  }

  if (leads.length === 0) {
    console.log("[Supervisor] Sin leads activos. Ciclo completado.");
    return reporte;
  }

  // ─── PIPELINE LEAD-POR-LEAD ─────────────────────────────────────────────────
  // Orden: trigger lead primero, luego por etapa (contacto_inicial → seguimiento → negociacion)
  const ORDEN_ETAPAS = ["nuevo", "contacto_inicial", "seguimiento", "negociacion", "reserva"];
  leads.sort((a, b) => {
    if (triggerLeadId) {
      if (String(a.id) === String(triggerLeadId)) return -1;
      if (String(b.id) === String(triggerLeadId)) return 1;
    }
    return ORDEN_ETAPAS.indexOf(a.etapa_actual) - ORDEN_ETAPAS.indexOf(b.etapa_actual);
  });

  reporte.leads_pre_filtrados  = 0;
  reporte.leads_a_procesar     = 0;
  reporte.contextos_sinteticos = 0;
  reporte.contextos_con_llm    = 0;

  for (const lead of leads) {
    const esTrigger = triggerLeadId && String(lead.id) === String(triggerLeadId);

    // Conteo por etapa — siempre, antes de cualquier filtro
    const etapaKey = lead.etapa_actual || "nuevo";
    if (reporte.por_etapa[etapaKey] !== undefined) reporte.por_etapa[etapaKey].total++;

    // PASO 2: Pre-filtro barato — solo log_wa, cero llamadas API
    if (!esTrigger) {
      const filtro = preFiltroPorLogWa(lead);
      if (!filtro.procesar) {
        reporte.leads_pre_filtrados++;
        continue;
      }
    }

    if (!lead.telefono) {
      console.warn(`[Ciclo] Lead ${lead.id} sin teléfono — omitido`);
      continue;
    }
    reporte.leads_a_procesar++;

    // PASO 3: Historial WhatsApp (Evolution API)
    let historial;
    try {
      historial = await evolution.obtenerHistorial(lead.telefono, 30);
    } catch (err) {
      console.error(`[Evolution] Error historial lead ${lead.id}:`, err.message);
      reporte.errores.push({ etapa: "historial", lead_id: lead.id, error: err.message });
      continue;
    }

    // PASO 4: Contexto — sintético si no hay msgs nuevos, LLM si los hay
    const ultimoSistema = parsearUltimaLineaSistema(lead.log_wa);
    const ultimoCliente  = historial.filter((m) => m.role === "lead").pop();
    const sistemaTs      = ultimoSistema ? new Date(ultimoSistema.timestamp) : null;
    const clienteTs      = ultimoCliente  ? new Date(ultimoCliente.timestamp)  : null;
    const TREINTA_DIAS   = 30 * 24 * 3_600_000;
    const sistemaObsoleto = sistemaTs && Date.now() - sistemaTs.getTime() > TREINTA_DIAS;
    const puedeSaltar = !esTrigger && ultimoSistema && sistemaTs && !sistemaObsoleto &&
                        (!clienteTs || clienteTs <= sistemaTs);

    let contexto;
    try {
      if (puedeSaltar) {
        contexto = construirContextoSintetico(ultimoSistema, lead, historial);
        reporte.contextos_sinteticos++;
        console.log(`[Contexto] Lead ${lead.id} ⚡ sintético`);
      } else {
        contexto = await extraerContexto({ ...lead }, historial);
        reporte.contextos_con_llm++;
      }
    } catch (err) {
      console.error(`[Contexto] Error lead ${lead.id}:`, err.message);
      reporte.errores.push({ etapa: "contexto", lead_id: lead.id, error: err.message });
      continue;
    }

    const leadEnriquecido = {
      ...lead,
      historial,
      contexto,
      historial_resumen:          contexto.resumen_conversacion,
      tiempo_sin_respuesta_horas: calcularHorasSinRespuesta(historial),
      ultimo_mensaje_cliente:     contexto.ultimo_mensaje_cliente,
      objeciones_detectadas:      contexto.objeciones_detectadas,
      alertas_previas:            contexto.alertas,
      contexto_sintetico:         !!contexto._sintetico,
    };

    // PASO 5: Supervisor evalúa SOLO este lead → UNA decisión
    let accion;
    try {
      const decision = await evaluarLead(leadEnriquecido);
      accion = {
        lead_id:            lead.id,
        nombre:             lead.nombre,
        etapa_actual:       lead.etapa_actual,
        prioridad:          decision.prioridad          || "media",
        accion:             decision.accion,
        agente_destino:     decision.agente_destino,
        instruccion_agente: decision.instruccion_agente || "",
        razon_decision:     decision.razon_decision     || "",
        nueva_etapa:        decision.nueva_etapa        || null,
        alerta:             decision.alerta             || null,
      };
      console.log(`\n[Lead ${lead.id}] ${lead.nombre || lead.telefono} | ${accion.accion} → ${accion.agente_destino || "—"} | ${accion.prioridad}`);
    } catch (err) {
      console.error(`[Supervisor] Error lead ${lead.id}:`, err.message);
      reporte.errores.push({ etapa: "supervisor", lead_id: lead.id, error: err.message });
      continue;
    }

    // Alerta crítica que viene junto a la decisión del supervisor
    if (accion.alerta?.tipo === "escalado") {
      const msg = `Lead: ${lead.nombre || lead.telefono} (${lead.telefono})\nMotivo: ${accion.alerta.descripcion}`;
      await evolution.alertarCoordinador(msg);
      await kommo.agregarNota(lead.id, `Alerta crítica: ${accion.alerta.descripcion}`);
      reporte.escalados_humano++;
    }

    console.log(`\n[Acción] ${lead.nombre || lead.telefono} | ${accion.etapa_actual} | ${accion.prioridad}`);

    const resultadoAccion = {
      lead_id:   accion.lead_id,
      nombre:    accion.nombre,
      telefono:  lead.telefono,
      prioridad: accion.prioridad,
      agente:    accion.agente_destino,
      enviado:   false,
      escalado:  false,
    };

    // Escalar a humano directamente
    if (accion.agente_destino === "humano") {
      const msg = `Lead: ${accion.nombre || lead.telefono} (${lead.telefono})\nEtapa: ${accion.etapa_actual}\nMotivo: ${accion.razon_decision}`;
      await evolution.alertarCoordinador(msg);
      await kommo.agregarNota(accion.lead_id, `Escalado: ${accion.razon_decision}`);
      resultadoAccion.escalado = true;
      reporte.escalados_humano++;
      reporte.detalle_acciones.push(resultadoAccion);
      continue;
    }

    // Esperar → no enviar nada
    if (accion.accion === "esperar") {
      console.log(`[Esperar] Motivo: ${accion.razon_decision}`);
      reporte.detalle_acciones.push({ ...resultadoAccion, razon: "esperar" });
      continue;
    }

    // ─── VALIDACIONES HARD (bloquean envío sin depender del prompt) ─────────
    const alertasCtx = lead.contexto?.alertas || [];
    const tonoCli = lead.contexto?.tono_cliente;

    // Hard 0 (ANTI-SPAM): si el bot envió mensaje hace menos de 20 horas Y el cliente
    // no respondió desde entonces → BLOQUEO. Esta validación es independiente del LLM
    // supervisor y previene rachas de mensajes (bug histórico de no respetar Regla 2).
    const VEINTE_HORAS_MS = 20 * 60 * 60 * 1000;
    const ahora = Date.now();
    const ultimoBotMsg = (lead.historial || [])
      .filter((m) => m.role !== "lead")
      .pop();
    const ultimoClienteMsg = (lead.historial || [])
      .filter((m) => m.role === "lead")
      .pop();
    if (ultimoBotMsg) {
      const tsBot = new Date(ultimoBotMsg.timestamp).getTime();
      const tsCli = ultimoClienteMsg ? new Date(ultimoClienteMsg.timestamp).getTime() : 0;
      const msDesdeBot = ahora - tsBot;
      const clienteRespondio = tsCli > tsBot;
      // Excepciones: si el cliente respondió DESPUÉS del último mensaje del bot, sí se puede contestar
      // O si es trigger por mensaje entrante (el cliente acaba de escribir)
      const esTriggerLead = triggerLeadId && String(lead.id) === String(triggerLeadId);
      if (msDesdeBot < VEINTE_HORAS_MS && !clienteRespondio && !esTriggerLead) {
        const horasDesde = (msDesdeBot / 3600000).toFixed(1);
        console.warn(
          `[HARD-BLOCK] Lead ${lead.id} ⏱️ anti-spam — último bot hace ${horasDesde}h, cliente no respondió`
        );
        await kommo.appendLog(
          accion.lead_id,
          `[SISTEMA-BLOQUEO] anti_spam:bot_hace_${horasDesde}h_sin_respuesta_cliente`
        );
        reporte.detalle_acciones.push({ ...resultadoAccion, razon: "hard_block_anti_spam" });
        continue;
      }
    }

    // Hard 1: cliente molesto → BLOQUEO TOTAL + escalado
    const esMolesto =
      tonoCli === "molesto" ||
      alertasCtx.some((a) => typeof a === "string" && a.includes("cliente_molesto"));
    if (esMolesto) {
      console.warn(`[HARD-BLOCK] Lead ${lead.id} ⛔ tono_molesto detectado — no se envía nada`);
      await evolution.alertarCoordinador(
        `⛔ CLIENTE MOLESTO — BOT PAUSADO 72h\n\n` +
          `Lead: ${lead.nombre || lead.telefono} (${lead.telefono})\n` +
          `Último mensaje cliente: "${(lead.ultimo_mensaje_cliente || "").substring(0, 200)}"\n\n` +
          `Atender personalmente. Bot bloqueado por tolerancia cero.`
      );
      await kommo.agregarNota(
        lead.id,
        `⛔ HARD-BLOCK: Cliente molesto — bot pausado 72h. Requiere atención humana.`
      );
      await kommo.appendLog(lead.id, `[SISTEMA-BLOQUEO] cliente_molesto:72h`);
      resultadoAccion.escalado = true;
      reporte.escalados_humano++;
      reporte.detalle_acciones.push({ ...resultadoAccion, razon: "hard_block_molesto" });
      continue;
    }

    // Hard 2: pregunta de identidad → escalar a humano siempre
    const preguntaIdentidad = alertasCtx.some(
      (a) => typeof a === "string" && a.includes("pregunta_identidad")
    );
    if (preguntaIdentidad) {
      console.warn(`[HARD-BLOCK] Lead ${lead.id} 👤 pregunta_identidad — escalando a humano`);
      await evolution.alertarCoordinador(
        `👤 CLIENTE PREGUNTÓ POR IDENTIDAD (¿bot/persona?)\n\n` +
          `Lead: ${lead.nombre || lead.telefono} (${lead.telefono})\n` +
          `Mensaje cliente: "${(lead.ultimo_mensaje_cliente || "").substring(0, 200)}"\n\n` +
          `Política: humano debe responder personalmente para preservar credibilidad.`
      );
      await kommo.agregarNota(
        lead.id,
        `👤 HARD-BLOCK: Cliente preguntó si es bot/IA — escalado a humano (política).`
      );
      await kommo.appendLog(lead.id, `[SISTEMA-BLOQUEO] pregunta_identidad`);
      resultadoAccion.escalado = true;
      reporte.escalados_humano++;
      reporte.detalle_acciones.push({ ...resultadoAccion, razon: "hard_block_identidad" });
      continue;
    }

    // PASO 5: Agente de Etapa genera mensaje → PASO 6: QA revisa
    let mensajeAprobado = null;
    let intentosQA = 0;
    let ultimaCorreccion = null;
    let errorLoop = null; // Captura el primer error técnico (OpenAI, red, etc.)

    while (intentosQA < MAX_REINTENTOS_QA && !mensajeAprobado) {
      intentosQA++;

      const instruccion = ultimaCorreccion
        ? `${accion.instruccion_agente}\n\nCORRECCIÓN QA (intento ${intentosQA}): ${ultimaCorreccion}`
        : accion.instruccion_agente;

      let borrador;
      try {
        borrador = await generarMensaje(
          accion.agente_destino,
          lead.contexto,
          instruccion,
          lead.historial
        );
      } catch (err) {
        console.error(`[Agente ${accion.agente_destino}] Error:`, err.message);
        errorLoop = `Agente error (intento ${intentosQA}): ${err.message}`;
        break;
      }

      let revision;
      try {
        revision = await revisarMensaje(borrador, lead.contexto, lead.historial, accion.instruccion_agente);
      } catch (err) {
        console.error("[QA] Error:", err.message);
        errorLoop = `QA error (intento ${intentosQA}): ${err.message}`;
        break;
      }

      if (revision.decision === "APRUEBA") {
        mensajeAprobado = revision.mensaje_final;
        console.log(`[QA] ✓ Aprobado (intento ${intentosQA})`);
      } else {
        ultimaCorreccion = revision.correcciones_sugeridas || revision.razones?.join(", ") || "sin detalle";
        reporte.mensajes_rechazados_qa++;
        console.warn(`[QA] ✗ Rechazado (${intentosQA}/${MAX_REINTENTOS_QA}): ${ultimaCorreccion}`);
      }
    }

    if (!mensajeAprobado) {
      const razonFinal = errorLoop || ultimaCorreccion || "sin razón registrada";
      const tipoFalla = errorLoop ? `Error técnico (${intentosQA} intento${intentosQA > 1 ? "s" : ""})` : `QA rechazó ${intentosQA} intento${intentosQA > 1 ? "s" : ""}`;
      const msg = `${tipoFalla}\nLead: ${lead.nombre || lead.telefono} (${lead.telefono})\nRazón: ${razonFinal}`;
      await evolution.alertarCoordinador(msg);
      await kommo.agregarNota(accion.lead_id, `Bot no pudo generar mensaje — ${tipoFalla.toLowerCase()}. Razón: ${razonFinal.substring(0, 100)}`);
      resultadoAccion.escalado = true;
      reporte.escalados_humano++;
    } else {
      // ─── VALIDACIONES HARD POST-QA (red de seguridad final) ───────────────
      const violacion = validarMensajeFinal(mensajeAprobado);
      if (violacion) {
        console.error(`[HARD-BLOCK] ⛔ Mensaje bloqueado tras QA: ${violacion}`);
        await evolution.alertarCoordinador(
          `⛔ MENSAJE BLOQUEADO POR VALIDACIÓN HARD\n\n` +
            `Lead: ${lead.nombre || lead.telefono} (${lead.telefono})\n` +
            `Violación: ${violacion}\n` +
            `Mensaje propuesto: "${mensajeAprobado.substring(0, 200)}"\n\n` +
            `Atender manualmente. El QA no atrapó el problema.`
        );
        await kommo.agregarNota(
          accion.lead_id,
          `⛔ HARD-BLOCK post-QA: ${violacion}. Mensaje NO enviado.`
        );
        await kommo.appendLog(accion.lead_id, `[SISTEMA-BLOQUEO] hard_validation:${violacion}`);
        resultadoAccion.escalado = true;
        resultadoAccion.error = `hard_block:${violacion}`;
        reporte.escalados_humano++;
        reporte.detalle_acciones.push(resultadoAccion);
        continue;
      }

      // PASO 7: Enviar por WhatsApp (número fijo: 593980243197)
      try {
        await evolution.enviarMensaje(lead.telefono, mensajeAprobado);

        // PASO 8: Actualizar Kommo
        // Mover etapa si el supervisor indicó cambio
        if (accion.nueva_etapa && accion.nueva_etapa !== lead.etapa_actual) {
          await kommo.moverEtapa(accion.lead_id, accion.nueva_etapa);
        }

        // Actualizar custom fields 360 con lo que el contexto conoce del lead
        // (tipo_evento, servicios_interes, precio_cotizado → price nativo)
        try {
          await kommo.actualizarCustomFields360(accion.lead_id, lead.contexto);
        } catch (errCf) {
          console.warn(`[CFields] Error actualizando custom fields lead ${accion.lead_id}:`, errCf.message);
        }

        // Registrar en log de conversación WA
        await kommo.appendLog(
          accion.lead_id,
          `[BOT→${accion.agente_destino}] ${mensajeAprobado.substring(0, 120)}`
        );

        // ─── VIDEO DEMO automático ──────────────────────────────────────────
        // Si el lead tiene tipo_evento identificado Y no se le ha enviado video
        // de ese tipo todavía Y la etapa es de venta/calificación, manda demo.
        try {
          const tipoEvento = lead.contexto?.datos_evento?.tipo
            || (Array.isArray(lead.tipo_evento) ? lead.tipo_evento[0] : null);
          const claveVideo = evolution.resolverTipoVideo(tipoEvento);
          const logActual = lead.log_wa || "";
          const yaEnviado = claveVideo && logActual.includes(`[SISTEMA-VIDEO] tipo=${claveVideo}`);
          const etapasParaVideo = ["contacto_inicial", "negociacion"];
          const esEtapaValida = etapasParaVideo.includes(accion.nueva_etapa || lead.etapa_actual);

          if (claveVideo && !yaEnviado && esEtapaValida) {
            // Pequeña pausa para que el texto llegue primero
            await new Promise((r) => setTimeout(r, 2000));
            const videoRes = await evolution.enviarVideo(lead.telefono, claveVideo);
            if (videoRes) {
              await kommo.appendLog(
                accion.lead_id,
                `[BOT→video] tipo=${claveVideo}`
              );
              await kommo.appendLog(
                accion.lead_id,
                `[SISTEMA-VIDEO] tipo=${claveVideo} enviado=true`
              );
              console.log(`[Video] 🎥 Demo "${claveVideo}" enviado al lead ${accion.lead_id}`);
            }
          }
        } catch (errVideo) {
          console.warn(`[Video] Error enviando demo al lead ${accion.lead_id}:`, errVideo.message);
        }

        // Línea [SISTEMA] — memoria persistente del estado de la IA después del envío.
        // El Agente Contexto la lee como fuente de verdad en el siguiente ciclo.
        try {
          const ctx = lead.contexto || {};
          const segPrev = ctx.conversacion?.num_seguimientos_enviados ?? 0;
          const segActual = accion.agente_destino === "seguimiento" ? segPrev + 1 : segPrev;
          const nivelNeg = ctx.nivel_negociacion ?? ctx.comercial?.nivel_negociacion_actual ?? 0;
          const precio = ctx.comercial?.precio_cotizado ?? "null";
          const etapaFinal = accion.nueva_etapa || lead.etapa_actual;
          const esp = ctx.espera_indicada;
          const espera = esp?.tiene_espera
            ? `${esp.tipo}:${esp.proxima_fecha_contacto || "?"}${esp.confirmacion_enviada ? "" : ":pendiente_confirmar"}`
            : "null";

          await kommo.appendLog(
            accion.lead_id,
            `[SISTEMA] etapa:${etapaFinal} | seg:${segActual} | neg:${nivelNeg} | precio:${precio} | espera:${espera}`
          );
        } catch (errSistema) {
          console.warn(`[SISTEMA log] No se pudo escribir línea de estado para lead ${accion.lead_id}:`, errSistema.message);
        }

        await kommo.agregarNota(
          accion.lead_id,
          `Mensaje enviado [${accion.agente_destino}]: "${mensajeAprobado.substring(0, 100)}"`
        );

        resultadoAccion.enviado = true;
        reporte.mensajes_enviados++;
        if (reporte.por_etapa[etapaKey] !== undefined) reporte.por_etapa[etapaKey].enviados++;
      } catch (err) {
        console.error(`[WhatsApp] Error enviando:`, err.message);
        resultadoAccion.error = err.message;
        reporte.errores.push({ etapa: "envio_whatsapp", lead_id: accion.lead_id, error: err.message });
      }
    }

    reporte.detalle_acciones.push(resultadoAccion);
  }

  reporte.duracion_ms = Date.now() - inicio;
  reporte.openai_usage = getUsage();
  reporte.openai_costo_usd = calcularCostoUSD(reporte.openai_usage);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`[Ciclo] ✓ Completado en ${reporte.duracion_ms}ms`);
  console.log(`[Ciclo] Enviados: ${reporte.mensajes_enviados} | Escalados: ${reporte.escalados_humano}`);
  console.log(`[Ciclo] OpenAI: ${reporte.openai_usage.total_tokens} tokens | $${reporte.openai_costo_usd}`);
  console.log(`${"═".repeat(60)}\n`);

  // Resumen ejecutivo — solo cuando n8n lo pide explícitamente (?barrido=true)
  // El CRON de 5 min NO lo envía. Solo el barrido diario de las 9 AM lo hace.
  if (!triggerLeadId && enviarResumen) {
    await enviarResumenEjecutivo(reporte).catch((err) =>
      console.error("[ResumenEjecutivo] Error enviando:", err.message)
    );
  }

  return reporte;
}

// ─── Entrada de mensaje entrante (webhook) ───────────────────────────────────

/**
 * Procesa un mensaje entrante de Evolution API para el número 593980243197.
 *
 * Soporta texto, audio (Whisper) e imagen (vision para comprobantes).
 * Implementa debounce: si llegan varios mensajes seguidos, espera 12s sin
 * nuevos antes de disparar el ciclo, así responde una sola vez al combo.
 */
async function procesarMensajeEntrante(payload) {
  // Solo procesar mensajes del número 360 Eventos
  const instancia = payload?.instance;
  if (instancia !== config.whatsapp.instance) {
    console.log(`[Webhook] Ignorando instancia: ${instancia} (esperado: ${config.whatsapp.instance})`);
    return;
  }

  const remoteJid = payload?.data?.key?.remoteJid || "";
  const esGrupo = remoteJid.includes("@g.us");
  if (esGrupo) return; // Ignorar grupos

  const telefono = remoteJid.replace("@s.whatsapp.net", "");
  const esDelBot = payload?.data?.key?.fromMe;
  if (esDelBot) return; // Ignorar mensajes propios

  const messageKey = payload?.data?.key;
  const msgId = messageKey?.id;
  const message = payload?.data?.message || {};

  const textoMensaje = message.conversation || message.extendedTextMessage?.text || null;
  const imagenMsg = message.imageMessage || null;
  const audioMsg = message.audioMessage || message.pttMessage || null;

  // ── Buscar lead existente — Node.js NUNCA crea leads. ────────────────────
  // Trabajamos solo con leads que ya están en Kommo (creados por otra fuente).
  // Si el teléfono no tiene lead todavía, ignoramos el mensaje hasta que aparezca.
  let lead = await kommo.buscarLeadPorTelefono(telefono);
  if (!lead) {
    console.log(`[Webhook] Mensaje de ${telefono} sin lead en Kommo — IGNORADO (Node.js no crea leads)`);
    return;
  }

  // Pausar IA → humano atiende, no hacemos nada (ni siquiera log automático)
  if (lead.pausar_ia) {
    console.log(`[Webhook] Lead ${lead.id} tiene "Pausar IA" activo — humano atiende`);
    return;
  }

  // ── 1. Mensaje de IMAGEN (sin texto) ─────────────────────────────────────
  if (imagenMsg && !textoMensaje && !audioMsg) {
    if (lead.etapa_actual === "negociacion" || lead.etapa_actual === "reserva") {
      console.log(`[Webhook] Imagen de lead ${lead.id} en ${lead.etapa_actual} — verificando comprobante`);
      await verificarComprobantePago(lead, messageKey, imagenMsg.caption || "");
    } else {
      await kommo.appendLog(lead.id, `[CLIENTE→imagen] (etapa: ${lead.etapa_actual}) ${imagenMsg.caption || ""}`);
      console.log(`[Webhook] Imagen registrada sin procesar (lead en ${lead.etapa_actual})`);
    }
    return;
  }

  // ── 2. Mensaje de AUDIO → transcribir con Whisper y tratar como texto ──
  let textoFinal = textoMensaje;

  if (audioMsg && !textoMensaje) {
    console.log(`[Webhook] Audio de ${telefono} (lead ${lead.id}) — transcribiendo con Whisper`);
    const base64Audio = await evolution.obtenerAudioBase64(remoteJid, msgId);
    if (!base64Audio) {
      await kommo.appendLog(lead.id, `[CLIENTE→audio] (no se pudo descargar)`);
      await evolution.alertarCoordinador(
        `⚠️ Lead envió audio pero no se pudo descargar\nLead: ${lead.nombre || lead.telefono} (${lead.telefono})\nRevisar manualmente.`
      );
      return;
    }

    try {
      const mime = audioMsg.mimetype || "audio/ogg";
      const transcripcion = await transcribirAudio(base64Audio, mime, "es");

      if (!transcripcion || transcripcion.length < 2) {
        await kommo.appendLog(lead.id, `[CLIENTE→audio] (vacío o ininteligible)`);
        return;
      }

      console.log(`[Whisper] Transcripción (${transcripcion.length} chars): "${transcripcion.substring(0, 80)}"`);
      textoFinal = transcripcion;
      await kommo.appendLog(lead.id, `[CLIENTE→audio→transcripción] ${transcripcion.substring(0, 200)}`);
    } catch (err) {
      console.error(`[Whisper] Error transcribiendo audio:`, err.message);
      await kommo.appendLog(lead.id, `[CLIENTE→audio] (error transcripción: ${err.message})`);
      await evolution.alertarCoordinador(
        `⚠️ Error transcribiendo audio\nLead: ${lead.nombre || lead.telefono}\nError: ${err.message}\nRevisar manualmente.`
      );
      return;
    }
  }

  // ── 3. Sin contenido procesable (otro tipo de mensaje) ──────────────────
  if (!textoFinal) {
    console.log(`[Webhook] Mensaje de ${telefono} sin texto procesable — tipo desconocido`);
    return;
  }

  // ── 4. Registrar en log + disparar ciclo con DEBOUNCE ──────────────────
  console.log(`[Webhook] Mensaje de ${telefono}: "${textoFinal.substring(0, 60)}"`);
  await kommo.appendLog(lead.id, `[CLIENTE] ${textoFinal.substring(0, 200)}`);

  // En vez de ejecutar el ciclo de inmediato, programa con debounce.
  // Si llegan más mensajes en 12s, se reinicia el contador y respondemos
  // al combo completo, no a cada mensaje suelto.
  programarCicloDebounced(lead.id);
}

// ─── Verificación de comprobante de pago ─────────────────────────────────────

/**
 * Cuando un lead en Negociación o Reserva envía una imagen, la descarga, la analiza
 * con GPT-4o vision para verificar si es un comprobante bancario válido, y compara
 * el monto detectado contra el 25% del precio cotizado en la negociación.
 *
 * Decisión:
 *   - Es comprobante + monto coincide con 25% acordado → mueve auto a Reserva + alerta OK
 *   - Es comprobante pero monto NO coincide → alerta al humano para verificar
 *   - No es comprobante → alerta + log
 */
async function verificarComprobantePago(lead, messageKey, captionImagen) {
  const jid = messageKey?.remoteJid;
  const msgId = messageKey?.id;
  const nombreLead = lead.nombre || lead.telefono;

  if (!jid || !msgId) {
    await evolution.alertarCoordinador(
      `⚠️ Lead envió imagen sin clave de mensaje\nLead: ${nombreLead} (${lead.telefono})\nRevisar manualmente en WhatsApp.`
    );
    return;
  }

  // 1. Descargar imagen
  const base64 = await evolution.obtenerImagenBase64(jid, msgId);
  if (!base64) {
    await evolution.alertarCoordinador(
      `⚠️ Lead envió imagen pero no se pudo descargar\nLead: ${nombreLead} (${lead.telefono})\nRevisar manualmente en WhatsApp.`
    );
    return;
  }

  // 2. Obtener precio cotizado del contexto (para calcular el 25% esperado)
  let precioCotizado = null;
  let anticipoEsperado = null;
  try {
    const historial = await evolution.obtenerHistorial(lead.telefono, 30);
    const contexto = await extraerContexto({ ...lead, telefono: lead.telefono }, historial);
    precioCotizado = contexto.comercial?.precio_cotizado ?? null;
    if (precioCotizado && precioCotizado > 0) {
      anticipoEsperado = Math.round(precioCotizado * 0.25 * 100) / 100;
    }
  } catch (err) {
    console.warn(`[Comprobante] No se pudo obtener contexto: ${err.message}`);
  }

  // 3. Analizar imagen con GPT-4o vision
  const SYSTEM = `Eres un asistente que analiza imágenes de comprobantes bancarios para una empresa de eventos en Ecuador.
Debes determinar si la imagen es un comprobante legítimo de transferencia o depósito bancario.
Responde SIEMPRE en JSON exacto, sin texto adicional.`;

  const pregunta = `Analiza esta imagen.

Contexto: El cliente debe pagar $${anticipoEsperado ?? "?"} (25% de $${precioCotizado ?? "?"}) como anticipo de un servicio de videobooth 360.
Caption de la imagen (si lo envió): "${captionImagen || "(sin caption)"}"

Responde SOLO este JSON:
{
  "es_comprobante": true o false,
  "tipo": "transferencia" | "deposito" | "pago_movil" | "otro" | null,
  "monto_detectado": número sin símbolo (ej: 52.50) o null,
  "banco_origen": "nombre del banco" o null,
  "banco_destino": "nombre del banco" o null,
  "fecha_transferencia": "fecha legible" o null,
  "referencia": "número de referencia/transacción" o null,
  "observaciones": "resumen de lo que ves en 1 oración"
}`;

  let resultado;
  try {
    resultado = await llamarConImagen(SYSTEM, pregunta, base64);
  } catch (err) {
    console.error("[Comprobante] Error analizando imagen:", err.message);
    await evolution.alertarCoordinador(
      `⚠️ Error al analizar imagen de comprobante\nLead: ${nombreLead} (${lead.telefono})\nError: ${err.message}\nRevisar manualmente.`
    );
    return;
  }

  // 4. Decisión según resultado
  if (!resultado.es_comprobante) {
    await evolution.alertarCoordinador(
      `⚠️ IMAGEN NO RECONOCIDA COMO COMPROBANTE\n\n` +
        `Lead: ${nombreLead} (${lead.telefono})\n` +
        `Etapa actual: ${lead.etapa_actual}\n` +
        `Observación: ${resultado.observaciones || "imagen no legible"}\n\n` +
        `Revisar manualmente.`
    );
    await kommo.appendLog(
      lead.id,
      `[IMAGEN] Recibida pero no reconocida como comprobante — ${resultado.observaciones || "?"}`
    );
    return;
  }

  // Es un comprobante. Comparar monto si tenemos referencia.
  const monto = resultado.monto_detectado;
  const detalleComprobante =
    `Tipo: ${resultado.tipo || "?"}\n` +
    `Monto detectado: $${monto ?? "no legible"}\n` +
    `Banco origen: ${resultado.banco_origen || "?"}\n` +
    `Banco destino: ${resultado.banco_destino || "?"}\n` +
    `Fecha: ${resultado.fecha_transferencia || "?"}\n` +
    `Referencia: ${resultado.referencia || "?"}`;

  const tolerancia = anticipoEsperado ? Math.max(anticipoEsperado * 0.05, 1) : null; // ±5% o $1
  const montoCoincide =
    anticipoEsperado != null && monto != null && Math.abs(monto - anticipoEsperado) <= tolerancia;

  // Política: si es comprobante válido → SIEMPRE mover a Reserva.
  // El monto sirve solo para diferenciar la alerta (✅ exacto vs ⚠️ revisar).
  try {
    if (lead.etapa_actual !== "reserva") {
      await kommo.moverEtapa(lead.id, "reserva");
    }

    if (montoCoincide) {
      // ✅ Coincide con el 25% acordado
      await kommo.agregarNota(
        lead.id,
        `✅ Pago verificado — Monto $${monto} coincide con 25% acordado ($${anticipoEsperado}). Lead movido a Reserva automáticamente.`
      );
      await kommo.appendLog(
        lead.id,
        `[COMPROBANTE OK] $${monto} = 25% de $${precioCotizado} | Auto-Reserva | ${resultado.observaciones}`
      );
      await evolution.alertarCoordinador(
        `✅ PAGO VERIFICADO — LEAD EN RESERVA\n\n` +
          `Lead: ${nombreLead} (${lead.telefono})\n` +
          detalleComprobante +
          `\n\n` +
          `Anticipo esperado (25% de $${precioCotizado}): $${anticipoEsperado}\n` +
          `✓ Monto coincide. Lead movido automáticamente a Reserva.\n\n` +
          `Después del evento, mueve manualmente a "Ganado" en Kommo.`
      );
    } else {
      // ⚠️ Monto no coincide (o sin referencia para comparar) — igual movemos a Reserva
      const motivoMismatch =
        anticipoEsperado == null
          ? `No hay precio cotizado registrado para comparar`
          : monto == null
          ? `Monto no legible en la imagen`
          : `Monto detectado $${monto} ≠ esperado $${anticipoEsperado} (diferencia $${Math.abs(monto - anticipoEsperado).toFixed(2)})`;

      await kommo.agregarNota(
        lead.id,
        `⚠️ Pago recibido con monto a verificar — $${monto ?? "?"} (esperado $${anticipoEsperado ?? "?"}) — ${motivoMismatch}. Lead movido a Reserva, requiere revisión humana.`
      );
      await kommo.appendLog(
        lead.id,
        `[COMPROBANTE ?] $${monto ?? "?"} vs esperado $${anticipoEsperado ?? "?"} | Auto-Reserva con alerta | ${resultado.observaciones}`
      );
      await evolution.alertarCoordinador(
        `⚠️ PAGO RECIBIDO — MONTO A VERIFICAR (lead movido a Reserva)\n\n` +
          `Lead: ${nombreLead} (${lead.telefono})\n` +
          detalleComprobante +
          `\n\n` +
          `Anticipo esperado: $${anticipoEsperado ?? "?"} (25% de $${precioCotizado ?? "?"})\n` +
          `Motivo de alerta: ${motivoMismatch}\n\n` +
          `Lead movido a Reserva automáticamente. Verificar el monto y, si es correcto, dejarlo. Si hay diferencia importante, contactar al cliente.`
      );
    }
  } catch (err) {
    console.error("[Comprobante] Error moviendo lead a Reserva:", err.message);
    await evolution.alertarCoordinador(
      `⚠️ COMPROBANTE RECIBIDO PERO ERROR AL MOVER ETAPA\n\n` +
        `Lead: ${nombreLead} (${lead.telefono})\n` +
        detalleComprobante +
        `\n\nError Kommo: ${err.message}\nMover manualmente a Reserva.`
    );
  }
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

/**
 * Validación HARD del mensaje final del bot — última red de seguridad antes
 * de enviar. Bloquea si el mensaje viola una regla crítica que el QA pudo
 * haber pasado por alto. Devuelve string con el motivo del bloqueo o null si OK.
 */
function validarMensajeFinal(mensaje) {
  if (!mensaje || typeof mensaje !== "string") return "mensaje_vacio";
  const txt = mensaje.toLowerCase();

  // 1. Precios bajo el mínimo — extraer cualquier "$N por X horas" o "$N para X h"
  // Mínimos: 1h=$100, 2h=$180, 3h=$230, 8h=$480
  const minimos = { 1: 100, 2: 180, 3: 230, 8: 480 };
  // Match patterns: "$150 por 2 horas", "$150 para 2h", "150 dolares 2 horas", "2h en $150"
  const regexPrecio = /\$?\s*(\d{2,4})\s*(?:por|para|en)?\s*(\d)\s*h(?:ora)?s?/g;
  const regexPrecio2 = /(\d)\s*h(?:ora)?s?\s*(?:por|en|de|a)\s*\$?\s*(\d{2,4})/g;
  for (const m of mensaje.matchAll(regexPrecio)) {
    const monto = parseInt(m[1], 10);
    const horas = parseInt(m[2], 10);
    if (minimos[horas] && monto < minimos[horas]) {
      return `precio_bajo_minimo:${horas}h=$${monto}<$${minimos[horas]}`;
    }
  }
  for (const m of mensaje.matchAll(regexPrecio2)) {
    const horas = parseInt(m[1], 10);
    const monto = parseInt(m[2], 10);
    if (minimos[horas] && monto < minimos[horas]) {
      return `precio_bajo_minimo:${horas}h=$${monto}<$${minimos[horas]}`;
    }
  }

  // 2. Servicios fuera de catálogo (lista negra de palabras clave)
  // Solo alerta si menciona en contexto de "incluye", "ofrecemos", "tenemos", "cotizar"
  const fueraCatalogo = [
    "dj", "sonido del evento", "iluminación general", "iluminacion general",
    "meseros", "catering", "comida", "bebidas", "bebida",
    "mobiliario", "mesas y sillas", "mantelería", "manteleria", "vajilla",
    "decoración del evento", "decoracion del evento",
    "arcos florales", "centros de mesa",
    "fotografía profesional", "fotografia profesional", "video del evento",
    "hora loca", "animadores", "payaso",
  ];
  const verbosOferta = ["incluye", "ofrecemos", "tenemos", "cotizar", "te paso", "te enviamos", "agregar"];
  const tieneVerboOferta = verbosOferta.some((v) => txt.includes(v));
  if (tieneVerboOferta) {
    for (const servicio of fueraCatalogo) {
      if (txt.includes(servicio)) {
        return `servicio_fuera_catalogo:${servicio}`;
      }
    }
  }

  // 3. Auto-revelación de IA / bot (regla absoluta del prompt)
  const revelaIA = [
    /soy (un |una )?(ia|inteligencia artificial|bot|robot|asistente virtual|asistente automatizado)/i,
    /(este|esto) es (un |una )?(bot|chatbot|sistema automatizado|respuesta automática)/i,
    /soy un (modelo|programa|software)/i,
  ];
  for (const rgx of revelaIA) {
    if (rgx.test(mensaje)) return "auto_revelacion_ia";
  }

  return null; // OK
}

/**
 * Extrae la última línea [SISTEMA] del log_wa de Kommo.
 * Formato esperado: "2026-05-11T10:00 [SISTEMA] etapa:X | seg:N | neg:M | precio:P | espera:E"
 * @returns {object|null} { timestamp, etapa, seg, neg, precio, espera } o null si no hay
 */
function parsearUltimaLineaSistema(logWa) {
  if (!logWa) return null;
  const lineas = logWa.split("\n").filter((l) => l.includes("[SISTEMA]"));
  if (!lineas.length) return null;
  const ultima = lineas[lineas.length - 1];
  const match = ultima.match(/^(\S+)\s+\[SISTEMA\]\s+(.+)$/);
  if (!match) return null;
  const timestamp = match[1];
  const campos = {};
  for (const par of match[2].split("|")) {
    const idx = par.indexOf(":");
    if (idx === -1) continue;
    const k = par.slice(0, idx).trim();
    const v = par.slice(idx + 1).trim();
    campos[k] = v;
  }
  return { timestamp, ...campos };
}

/**
 * Construye un contexto sintético desde la línea [SISTEMA] cuando no hay mensajes
 * nuevos del cliente — evita una llamada a OpenAI sin perder estado crítico.
 */
function construirContextoSintetico(sistemaData, lead, historial) {
  const ultimoCliente = historial.filter((m) => m.role === "lead").pop();
  const ultimoBot = historial.filter((m) => m.role !== "lead").pop();

  // Parsear el campo "espera" — formato: tipo:fecha[:pendiente_confirmar] o "null"
  let espera = {
    tiene_espera: false,
    tipo: null,
    descripcion: null,
    confirmacion_enviada: null,
    proxima_fecha_contacto: null,
  };
  if (sistemaData.espera && sistemaData.espera !== "null") {
    const partes = sistemaData.espera.split(":");
    espera = {
      tiene_espera: true,
      tipo: partes[0] || null,
      descripcion: null,
      confirmacion_enviada: !partes.includes("pendiente_confirmar"),
      proxima_fecha_contacto: partes[1] && partes[1] !== "?" ? partes[1] : null,
    };
  }

  const precio = sistemaData.precio === "null" || sistemaData.precio == null
    ? null
    : Number(sistemaData.precio);
  const nivelNeg = Number(sistemaData.neg ?? 0);
  const numSeg = Number(sistemaData.seg ?? 0);

  const resumen = "Sin mensajes nuevos del cliente desde el último ciclo. Estado cargado desde memoria persistente [SISTEMA].";

  return {
    lead_id: lead.id,
    nombre: lead.nombre,
    telefono: lead.telefono,
    etapa_actual: sistemaData.etapa || lead.etapa_actual,
    datos_evento: {
      tipo: lead.tipo_evento?.[0] || null,
      fecha: null,
      lugar: null,
      es_provincia: false,
      duracion_horas: null,
      num_invitados: null,
      servicio_interes: lead.servicios_interes?.[0] || null,
      requiere_factura: null,
    },
    comercial: {
      precio_cotizado: precio,
      duracion_cotizada: null,
      descuentos_ofrecidos: [],
      nivel_negociacion_actual: nivelNeg,
      anticipo_solicitado: false,
      anticipo_confirmado: false,
    },
    conversacion: {
      ultimo_mensaje_cliente: ultimoCliente?.content || "",
      ultimo_mensaje_bot: ultimoBot?.content || "",
      horas_sin_respuesta: 0,
      num_seguimientos_enviados: numSeg,
      tono_cliente: "frio",
      objeciones: [],
      preguntas_sin_responder: [],
      resumen,
    },
    espera_indicada: espera,
    siguiente_accion_recomendada: "Evaluar si corresponde seguimiento según tiempo transcurrido y estado de espera.",
    alertas: [],
    // Aliases planos para compatibilidad
    resumen_conversacion: resumen,
    ultimo_mensaje_cliente: ultimoCliente?.content || "",
    objeciones_detectadas: [],
    tono_cliente: "frio",
    nivel_negociacion: nivelNeg,
    _sintetico: true, // marca para debug y reportes
  };
}

/**
 * Pre-filtro barato: decide si un lead necesita atención en este ciclo
 * usando SOLO su log_wa de Kommo (ya disponible, sin llamadas a API externas).
 *
 * Filtra fuera:
 *   - Lead donde el bot escribió hace < 20h y el cliente no respondió después (anti-spam)
 *   - Lead en espera con fecha futura (cliente_avisara / reunion_programada)
 *
 * Devuelve { procesar: bool, razon: string }
 */
function preFiltroPorLogWa(lead) {
  const log = lead.log_wa || "";

  // ── 1. Espera con fecha futura ────────────────────────────────────────────
  const ultimoSistema = parsearUltimaLineaSistema(log);
  if (ultimoSistema?.espera && ultimoSistema.espera !== "null") {
    const partes = ultimoSistema.espera.split(":");
    const fechaEspera = partes[1]; // formato YYYY-MM-DD
    if (fechaEspera && fechaEspera !== "?" && fechaEspera.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const hoyEC = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
      if (fechaEspera > hoyEC) {
        return { procesar: false, razon: `espera_hasta:${fechaEspera}` };
      }
    }
  }

  // ── 2. Anti-spam desde log_wa ─────────────────────────────────────────────
  // Busca la línea más reciente [BOT→...] y verifica si hubo [CLIENTE] después.
  if (!log) return { procesar: true, razon: "sin_log" };

  const lineas = log.split("\n").filter((l) => l.trim());
  // Recorrer de atrás hacia adelante
  let ultimaBotTs = null;
  let clienteRespondioDesdeBot = false;

  for (let i = lineas.length - 1; i >= 0; i--) {
    const linea = lineas[i];

    // Si encontramos un mensaje del cliente ANTES de haber encontrado el bot → respondió
    if (ultimaBotTs === null && linea.includes("[CLIENTE")) {
      // Hay mensaje de cliente más reciente que cualquier bot → siempre procesar
      clienteRespondioDesdeBot = true;
      break;
    }

    if (linea.includes("[BOT→") && !linea.includes("[SISTEMA-BLOQUEO]")) {
      // Extraer timestamp (formato ISO al inicio de la línea)
      const tsMatch = linea.match(/^(\d{4}-\d{2}-\d{2}T[\d:.Z+\-]+)\s+/);
      if (tsMatch) {
        ultimaBotTs = new Date(tsMatch[1]).getTime();
        if (isNaN(ultimaBotTs)) { ultimaBotTs = null; continue; }
        // Ya tenemos el último bot — revisar si hay cliente DESPUÉS en líneas posteriores
        for (let j = i + 1; j < lineas.length; j++) {
          if (lineas[j].includes("[CLIENTE")) {
            clienteRespondioDesdeBot = true;
            break;
          }
        }
        break; // encontramos el último bot
      }
    }
  }

  if (!ultimaBotTs) return { procesar: true, razon: "nunca_contactado" };
  if (clienteRespondioDesdeBot) return { procesar: true, razon: "cliente_respondio" };

  const VEINTE_HORAS_MS = 20 * 60 * 60 * 1000;
  const horasDesdeBot = (Date.now() - ultimaBotTs) / 3_600_000;
  if (horasDesdeBot >= 20) return { procesar: true, razon: "20h_pasadas" };

  return { procesar: false, razon: `anti_spam_log:${horasDesdeBot.toFixed(1)}h_sin_respuesta` };
}

/**
 * Envía resumen ejecutivo del barrido diario al WhatsApp del dueño.
 * Solo se llama cuando triggerLeadId === null (barrido completo, no webhook individual).
 */
async function enviarResumenEjecutivo(reporte) {
  const WA_DUENO = process.env.WA_DUENO_360;
  if (!WA_DUENO) {
    console.warn("[ResumenEjecutivo] WA_DUENO_360 no configurado");
    return;
  }

  const hora = new Date().toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
    dateStyle: "short",
    timeStyle: "short",
  });

  const uso   = reporte.openai_usage || {};
  const costo = reporte.openai_costo_usd ?? 0;
  const duracionMin = reporte.duracion_ms ? (reporte.duracion_ms / 60000).toFixed(1) : "?";

  const cerrados = (reporte.detalle_acciones || []).filter(
    (a) => a.nueva_etapa === "perdido" || a.razon === "hard_close_5_sin_respuesta"
  ).length;

  const pe = reporte.por_etapa || {};
  const fmt = (e) => {
    const s = pe[e] || { total: 0, enviados: 0 };
    return `${s.enviados}/${s.total}`;
  };

  const lineas = [
    `*📋 RESUMEN BARRIDO DIARIO 360*`,
    `_${hora} · ${duracionMin} min_`,
    ``,
    `*━━━ EMBUDO ━━━*`,
    `📥 Leads entrantes:    ${fmt("nuevo")}`,
    `🤝 Contacto inicial:   ${fmt("contacto_inicial")}`,
    `📲 Seguimiento:        ${fmt("seguimiento")}`,
    `💬 Negociación:        ${fmt("negociacion")}`,
    `✅ Reserva:            ${fmt("reserva")}`,
    `🚪 Cerrados hoy:       *${cerrados}*`,
  ];

  if ((reporte.escalados_humano || 0) > 0) {
    lineas.push(`👤 Escalados:          *${reporte.escalados_humano}*`);
  }
  if ((reporte.mensajes_rechazados_qa || 0) > 0) {
    lineas.push(`⚠️ Rechazados QA:      *${reporte.mensajes_rechazados_qa}*`);
  }
  if ((reporte.errores || []).length > 0) {
    lineas.push(`❌ Errores:            *${reporte.errores.length}* (ver logs)`);
  }

  lineas.push(``);
  lineas.push(`*━━━ COSTO OPENAI ━━━*`);
  lineas.push(`📥 Tokens entrada:  ${(uso.prompt_tokens     || 0).toLocaleString("es-EC")}`);
  lineas.push(`📤 Tokens salida:   ${(uso.completion_tokens || 0).toLocaleString("es-EC")}`);
  lineas.push(`💵 Costo estimado:  *$${costo.toFixed(4)}*`);

  const txt = lineas.join("\n");
  await evolution.enviarSistema(WA_DUENO, txt);
  console.log(`[ResumenEjecutivo] ✓ Enviado desde marketa_system a ${WA_DUENO}`);
}

function calcularHorasSinRespuesta(historial) {
  // BOT_START_DATE: fecha desde la que empieza a contar el bot (YYYY-MM-DD, hora Ecuador UTC-5)
  // Permite hacer "día 0" para todos los leads existentes sin disparar seguimientos prematuros
  const BOT_START_DATE = process.env.BOT_START_DATE
    ? new Date(process.env.BOT_START_DATE + "T00:00:00-05:00")
    : null;

  const mensajesCliente = historial.filter((m) => m.role === "lead");

  if (mensajesCliente.length === 0) {
    // Sin historial: si hay fecha de inicio, contar desde ahí; si no, tratar como muy antiguo
    if (BOT_START_DATE) return (Date.now() - BOT_START_DATE.getTime()) / (1000 * 60 * 60);
    return 999;
  }

  const ultimo = new Date(mensajesCliente[mensajesCliente.length - 1].timestamp);

  // Si el último mensaje del cliente es anterior al inicio del bot,
  // usamos BOT_START_DATE como referencia para no disparar seguimientos prematuros
  const referencia = BOT_START_DATE && ultimo < BOT_START_DATE ? BOT_START_DATE : ultimo;

  return (Date.now() - referencia.getTime()) / (1000 * 60 * 60);
}

// obtenerTelefonoLead eliminado — el teléfono ahora viene en batch
// desde kommo.obtenerLeadsActivos() usando obtenerTelefonosPorContactos()

module.exports = { ejecutarCiclo, procesarMensajeEntrante };
