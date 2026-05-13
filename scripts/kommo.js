/**
 * Adaptador Kommo CRM — Sistema 360 Eventos
 *
 * Solo lee y escribe en el pipeline 8699516 (360 Eventos).
 * No toca ningún otro pipeline de marketas.kommo.com.
 *
 * Etapas reales:
 *   68329664 → Incoming leads
 *   68329668 → Contacto inicial
 *   68659032 → SEGUIMIENTO
 *   68329672 → Negociación
 *   68329676 → Reserva
 *   142      → Leads ganados
 *   143      → Leads perdidos
 */

const config = require("./config");

const BASE = `https://${config.kommo.subdominio}.kommo.com/api/v4`;

// ─── Mapeos de valores del bot → enum IDs de Kommo ────────────────────────

const TIPO_EVENTO_ENUM = {
  boda:              850953,
  matrimonio:        850953,
  quinceanos:        850955,
  quinceañera:       850955,
  "15_anos":         850955,
  "quinceañeros":    850955,
  cumpleanos:        850957,
  cumpleaños:        850957,
  birthday:          850957,
  dulces_16:         850959,
  "16_anos":         850959,
  "18_anos":         850961,
  grado_escuela:     850963,
  grado_colegio:     850965,
  graduacion:        850967,
  grado_universidad: 850967,
  corporativo:       850969,
  empresa:           850969,
  corporate:         850969,
};

const SERVICIOS_ENUM = {
  videobooth:  850943,
  video_360:   850943,
  "360":       850943,
  photobooth:  850945,
  fotos:       850945,
  niebla:      850947,
  niebla_baja: 850947,
  pirotecnia:  850949,
  pirotecnia_2:850949,
  pirotecnia_4:850951,
};
const headers = () => ({
  Authorization: `Bearer ${config.kommo.accessToken}`,
  "Content-Type": "application/json",
});

// ─── Lectura de leads ─────────────────────────────────────────────────────

/**
 * Obtiene todos los leads activos del pipeline 360 en Kommo.
 * Excluye ganados y perdidos.
 * Si "Pausar IA" está marcado, los excluye también (el humano los atiende).
 */
async function obtenerLeadsActivos() {
  let pagina = 1;
  let todosLosLeads = [];

  // Paginar hasta obtener todos los leads del pipeline
  while (true) {
    const url = new URL(`${BASE}/leads`);
    url.searchParams.set("filter[pipeline_id]", config.kommo.pipelineId);
    url.searchParams.set("with", "contacts,custom_fields_values");
    url.searchParams.set("limit", "50");
    url.searchParams.set("page", String(pagina));
    url.searchParams.set("order[updated_at]", "desc");

    const res = await fetch(url.toString(), { headers: headers() });
    if (!res.ok) throw new Error(`Kommo leads: ${res.status} ${await res.text()}`);

    const data = await res.json();
    const leads = data?._embedded?.leads || [];

    if (leads.length === 0) break;
    todosLosLeads = todosLosLeads.concat(leads);
    if (leads.length < 50) break; // última página
    pagina++;
  }

  console.log(`[Kommo] Leads totales en pipeline 360: ${todosLosLeads.length}`);

  // Filtrar cerrados y con Pausar IA
  const leadsFiltrados = todosLosLeads.filter((l) => {
    if ([142, 143].includes(l.status_id)) return false;
    const cfv = l.custom_fields_values || [];
    const pausarIA = cfv.find((c) => c.field_id === config.kommo.campos.pausar_ia);
    if (pausarIA?.values?.[0]?.value === true) return false;
    return true;
  });

  // Obtener teléfonos en batch (evita 2 llamadas API por lead)
  const contactIds = [...new Set(
    leadsFiltrados.flatMap((l) => (l._embedded?.contacts || []).map((c) => c.id))
  )];
  const telefonosPorContacto = await obtenerTelefonosPorContactos(contactIds);

  console.log(`[Kommo] Leads activos en pipeline 360: ${leadsFiltrados.length}`);

  return leadsFiltrados.map((l) => {
    const contactId = l._embedded?.contacts?.[0]?.id;
    const telefono = contactId ? (telefonosPorContacto[contactId] || null) : null;
    return { ...normalizarLead(l), telefono };
  });
}

/**
 * Obtiene el teléfono de una lista de contactos en batch (hasta 50 por llamada).
 * Evita hacer 2 llamadas API por lead en el ciclo supervisor.
 */
async function obtenerTelefonosPorContactos(contactIds) {
  if (!contactIds.length) return {};
  const mapa = {};

  for (let i = 0; i < contactIds.length; i += 50) {
    const lote = contactIds.slice(i, i + 50);
    const url = new URL(`${BASE}/contacts`);
    lote.forEach((id) => url.searchParams.append("id[]", id));
    url.searchParams.set("limit", "50");

    try {
      const res = await fetch(url.toString(), { headers: headers() });
      if (!res.ok) continue;
      const data = await res.json();
      for (const c of data?._embedded?.contacts || []) {
        const tel = c.custom_fields_values
          ?.find((f) => f.field_code === "PHONE")
          ?.values?.[0]?.value?.replace(/\D/g, "");
        if (tel) mapa[c.id] = tel;
      }
    } catch {
      // continuar con siguiente lote
    }
  }

  return mapa;
}

/**
 * Obtiene un lead por ID con todos sus campos
 */
async function obtenerLead(leadId) {
  const res = await fetch(
    `${BASE}/leads/${leadId}?with=contacts,custom_fields_values`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`Kommo lead ${leadId}: ${res.status}`);
  return normalizarLead(await res.json());
}

/**
 * Busca lead en el pipeline 360 por número de teléfono
 */
async function buscarLeadPorTelefono(telefono) {
  const tel = telefono.replace(/\D/g, "");

  const url = new URL(`${BASE}/contacts`);
  url.searchParams.set("query", tel);
  url.searchParams.set("with", "leads");

  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) return null;

  const data = await res.json();
  const contactos = data?._embedded?.contacts || [];

  for (const contacto of contactos) {
    for (const leadRef of contacto._embedded?.leads || []) {
      try {
        const lead = await obtenerLead(leadRef.id);
        if (lead.pipelineId === config.kommo.pipelineId) return lead;
      } catch { continue; }
    }
  }
  return null;
}

// ─── Creación ─────────────────────────────────────────────────────────────

/**
 * Crea un nuevo lead en el pipeline 360 para un número de WhatsApp
 */
async function crearLead(telefono, nombreInicial = null) {
  const nombre = nombreInicial || `Lead 360 ${telefono}`;
  const body = {
    _embedded: {
      leads: [{
        name: nombre,
        pipeline_id: config.kommo.pipelineId,
        status_id: config.kommo.etapas.nuevo,
        _embedded: {
          contacts: [{
            name: nombre,
            custom_fields_values: [{
              field_code: "PHONE",
              values: [{ value: telefono, enum_code: "WHATSAPP" }],
            }],
          }],
        },
      }],
    },
  };

  const res = await fetch(`${BASE}/leads/complex`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Crear lead: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const leadId = data?._embedded?.leads?.[0]?.id;
  return obtenerLead(leadId);
}

// ─── Actualización ────────────────────────────────────────────────────────

/**
 * Mueve el lead a una etapa del pipeline 360
 * @param {number} leadId
 * @param {string} nombreEtapa - key de config.kommo.etapas
 */
async function moverEtapa(leadId, nombreEtapa) {
  const statusId = config.kommo.etapas[nombreEtapa];
  if (!statusId) throw new Error(`Etapa desconocida: ${nombreEtapa}`);

  const res = await fetch(`${BASE}/leads`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify([{ id: Number(leadId), status_id: statusId }]),
  });
  if (!res.ok) throw new Error(`Mover etapa ${leadId}: ${res.status}`);
}

/**
 * Actualiza campos personalizados del lead
 * @param {number} leadId
 * @param {object} campos - { tipo_evento, servicios_interes, log_wa, pausar_ia }
 */
async function actualizarCampos(leadId, campos) {
  const cfv = [];

  for (const [clave, valor] of Object.entries(campos)) {
    const fieldId = config.kommo.campos[clave];
    if (!fieldId || valor === undefined) continue;
    cfv.push({ field_id: fieldId, values: [{ value: valor }] });
  }

  if (cfv.length === 0) return;

  const res = await fetch(`${BASE}/leads`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify([{ id: Number(leadId), custom_fields_values: cfv }]),
  });
  if (!res.ok) throw new Error(`Actualizar campos ${leadId}: ${res.status}`);
}

/**
 * Actualiza automáticamente los custom fields 360 desde el contexto del agente.
 * Escribe: Tipo de Evento, Servicios de Interés, y el price nativo (presupuesto cotizado).
 * Solo sobreescribe si el contexto tiene datos nuevos — no borra lo que ya había.
 *
 * @param {number} leadId
 * @param {object} ctx  — objeto context devuelto por agente_contexto
 */
async function actualizarCustomFields360(leadId, ctx) {
  if (!ctx) return;
  const updates = { id: Number(leadId) };
  const cfv = [];

  // Helper: normaliza texto a clave del mapa (minúsculas, sin tildes, guiones por espacios)
  const norm = (s) =>
    (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, "_")
      .trim();

  // ── 1. Tipo de Evento ────────────────────────────────────────────────────
  const tipoRaw = ctx.datos_evento?.tipo || null;
  if (tipoRaw) {
    const enumId = TIPO_EVENTO_ENUM[norm(tipoRaw)] ?? TIPO_EVENTO_ENUM[tipoRaw.toLowerCase()];
    if (enumId) cfv.push({ field_id: 1157833, values: [{ enum_id: enumId }] });
  }

  // ── 2. Servicios de Interés ──────────────────────────────────────────────
  const servicioRaw = ctx.datos_evento?.servicio_interes;
  const candidatos = [];
  if (servicioRaw) candidatos.push(servicioRaw);
  if (ctx.servicios_interes && Array.isArray(ctx.servicios_interes)) {
    candidatos.push(...ctx.servicios_interes);
  }
  const enumsServicios = [];
  for (const s of candidatos) {
    const enumId = SERVICIOS_ENUM[norm(s)] ?? SERVICIOS_ENUM[s.toLowerCase()];
    if (enumId && !enumsServicios.includes(enumId)) enumsServicios.push(enumId);
  }
  // Por defecto, si hay cualquier interés sin servicio explícito, asumimos Videobooth
  if (enumsServicios.length === 0 && (tipoRaw || servicioRaw)) {
    enumsServicios.push(850943); // Videobooth
  }
  if (enumsServicios.length > 0) {
    cfv.push({ field_id: 1157831, values: enumsServicios.map((id) => ({ enum_id: id })) });
  }

  // ── 3. Precio cotizado → campo nativo price del lead ────────────────────
  const precio = ctx.comercial?.precio_cotizado ?? null;
  if (precio && Number(precio) > 0) {
    updates.price = Number(precio);
  }

  if (cfv.length > 0) updates.custom_fields_values = cfv;
  if (Object.keys(updates).length <= 1) return; // nada que actualizar

  try {
    const res = await fetch(`${BASE}/leads`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify([updates]),
    });
    if (!res.ok) {
      console.warn(`[Kommo] actualizarCustomFields360 ${leadId}: ${res.status}`);
    } else {
      const partes = [];
      if (tipoRaw) partes.push(`tipo=${tipoRaw}`);
      if (enumsServicios.length) partes.push(`servicios=[${enumsServicios.join(",")}]`);
      if (updates.price) partes.push(`price=$${updates.price}`);
      console.log(`[Kommo] ✓ Custom fields 360 actualizados lead ${leadId}: ${partes.join(" | ")}`);
    }
  } catch (err) {
    console.warn(`[Kommo] Error actualizarCustomFields360 ${leadId}:`, err.message);
  }
}

/**
 * Actualiza el nombre del lead (cuando sabemos el nombre del cliente)
 */
async function actualizarNombre(leadId, nombre) {
  const res = await fetch(`${BASE}/leads`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify([{ id: Number(leadId), name: nombre }]),
  });
  if (!res.ok) console.warn(`[Kommo] No se pudo actualizar nombre lead ${leadId}`);
}

/**
 * Agrega una nota interna al lead
 */
async function agregarNota(leadId, texto) {
  const body = {
    _embedded: {
      notes: [{
        entity_id: Number(leadId),
        note_type: "common",
        params: { text: `🤖 ${texto}` },
      }],
    },
  };

  const res = await fetch(`${BASE}/leads/${leadId}/notes`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) console.warn(`[Kommo] Error nota ${leadId}: ${res.status}`);
}

/**
 * Appends text to the LOG_CONVERSACION_WA field (keeps history rolling)
 */
async function appendLog(leadId, linea) {
  const lead = await obtenerLead(leadId);
  const logActual = lead.log_wa || "";
  // 8000 chars ≈ 60-80 líneas de log → suficiente para retener líneas [SISTEMA] de los últimos ciclos
  const nuevoLog = `${logActual}\n${new Date().toISOString().slice(0, 16)} ${linea}`.slice(-8000);
  await actualizarCampos(leadId, { log_wa: nuevoLog });
}

// ─── Normalización ────────────────────────────────────────────────────────

function normalizarLead(lead) {
  const cfv = lead.custom_fields_values || [];

  const getCampo = (fieldId) => {
    if (!fieldId) return null;
    const c = cfv.find((f) => f.field_id === fieldId);
    return c?.values?.[0]?.value ?? null;
  };

  const getMulti = (fieldId) => {
    if (!fieldId) return [];
    const c = cfv.find((f) => f.field_id === fieldId);
    return c?.values?.map((v) => v.value) ?? [];
  };

  return {
    id: lead.id,
    nombre: lead.name,
    pipelineId: lead.pipeline_id,
    etapaId: lead.status_id,
    etapa_actual: resolverNombreEtapa(lead.status_id),
    timestamp_creacion: lead.created_at,
    timestamp_actualizacion: lead.updated_at,
    // Campos personalizados
    pausar_ia:         getCampo(config.kommo.campos.pausar_ia) === true,
    tipo_evento:       getMulti(config.kommo.campos.tipo_evento),
    servicios_interes: getMulti(config.kommo.campos.servicios_interes),
    log_wa:            getCampo(config.kommo.campos.log_wa),
  };
}

function resolverNombreEtapa(statusId) {
  for (const [nombre, id] of Object.entries(config.kommo.etapas)) {
    if (id === statusId) return nombre;
  }
  return "desconocida";
}

module.exports = {
  obtenerLeadsActivos,
  obtenerLead,
  buscarLeadPorTelefono,
  crearLead,
  moverEtapa,
  actualizarCampos,
  actualizarCustomFields360,
  actualizarNombre,
  agregarNota,
  appendLog,
};
