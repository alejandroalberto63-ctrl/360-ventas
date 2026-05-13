/**
 * Configuración central — Sistema 360 Eventos
 * Solo opera sobre el pipeline 8699516 y el número 593980243197.
 */

module.exports = {
  // ─── WhatsApp 360 Eventos (canal de ventas con clientes) ─────────────────
  whatsapp: {
    numero: "593980243197",
    instance: "360eventos",
    apiUrl: process.env.EVOLUTION_API_URL || "https://marketa-evolution-api.hoqkyr.easypanel.host",
    apiKey: process.env.EVOLUTION_API_KEY || "C7A48B3A1DEC-43C7-BE25-66431EE6F47B",
  },

  // ─── WhatsApp Marketa System (notificaciones internas del sistema) ────────
  // Este número NUNCA habla con clientes — solo envía alertas, reportes y
  // resúmenes ejecutivos al coordinador y al dueño.
  sistema: {
    numero: "593987841594",
    instance: process.env.MARKETA_SYSTEM_INSTANCE || "marketa_system",
  },

  // ─── Kommo CRM ───────────────────────────────────────────────────────────
  kommo: {
    subdominio: "marketas",
    accessToken: process.env.KOMMO_ACCESS_TOKEN,
    pipelineId: 8699516,

    // Etapas reales del pipeline 360
    etapas: {
      nuevo:            68329664,  // Incoming leads
      contacto_inicial: 68329668,  // Contacto inicial
      seguimiento:      68659032,  // SEGUIMIENTO
      negociacion:      68329672,  // Negociación
      reserva:          68329676,  // Reserva (propuesta aceptada)
      ganado:           142,       // Leads ganados
      perdido:          143,       // Leads perdidos
    },

    // Campos personalizados existentes en Kommo
    campos: {
      pausar_ia:         1157829,  // Checkbox — si está marcado el bot NO actúa
      tipo_evento:       1157833,  // Multiselect — tipo de evento
      servicios_interes: 1157831,  // Multiselect — servicios que le interesan
      log_wa:            1158003,  // Textarea — log de conversación WhatsApp
    },
  },

  // ─── OpenAI ──────────────────────────────────────────────────────────────
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    modelo: "gpt-4o",
  },

  // ─── Comportamiento del Supervisor ───────────────────────────────────────
  supervisor: {
    intervaloCicloMinutos: 20,
    maxReintentosQA: 3,
    seguimiento: {
      primerMensaje:  24,   // horas sin respuesta → primer seguimiento
      segundoMensaje: 48,   // horas → segundo seguimiento
      escalarHumano:  72,   // horas → escalar a coordinador
      reactivacion:   168,  // 7 días → mensaje de reactivación
    },
    waCoordinador:  process.env.WA_COORDINADOR_360,  // Erika
    waDueno:        process.env.WA_DUENO_360,         // Alberto
  },
};
