/**
 * Clasificador determinístico de etapa — 360 Eventos
 *
 * La etapa del lead se determina por señales objetivas extraídas del log,
 * no por la intuición del LLM. Esta función es la fuente de verdad para
 * movimientos automáticos de etapa en el pipeline.
 *
 * Prioridad (de mayor a menor): reserva > negociacion > seguimiento > contacto_inicial
 */

/**
 * Clasifica la etapa correcta de un lead según señales objetivas.
 *
 * @param {object} params
 * @param {boolean} params.clienteRespondioAlBot  — Cliente respondió al bot al menos 1 vez
 * @param {boolean} params.cuentaBancariaEnviada  — Bot ya envió datos bancarios antes
 * @param {boolean} [params.botVaAEnviarCuentaEnEsteCiclo] — Bot enviará datos bancarios AHORA
 * @param {boolean} [params.anticipoConfirmado]   — Pago confirmado (comprobante verificado)
 * @param {string}  params.etapaActual            — Etapa actual del lead en Kommo
 * @returns {string} Nombre de la etapa correcta
 */
function clasificarEtapaAutomatica({
  clienteRespondioAlBot,
  cuentaBancariaEnviada,
  botVaAEnviarCuentaEnEsteCiclo = false,
  anticipoConfirmado = false,
  etapaActual,
}) {
  // Etapas terminales — nunca mover automáticamente
  if (["ganado", "perdido", "reserva"].includes(etapaActual)) {
    return etapaActual;
  }

  // Prioridad 1: anticipo confirmado → reserva
  if (anticipoConfirmado) return "reserva";

  // Prioridad 2: datos bancarios enviados o por enviar → negociacion
  if (cuentaBancariaEnviada || botVaAEnviarCuentaEnEsteCiclo) return "negociacion";

  // Prioridad 3: cliente respondió al bot → seguimiento
  if (clienteRespondioAlBot) return "seguimiento";

  // Default: sin interacción real del cliente → contacto_inicial
  return "contacto_inicial";
}

/**
 * Extrae las señales de clasificación desde el contexto ya construido.
 * Funciona tanto con contexto LLM como sintético.
 *
 * @param {object} contexto — Salida de extraerContexto() o construirContextoSintetico()
 * @param {string} etapaActual — Etapa actual del lead en Kommo
 * @returns {object} Señales listas para pasar a clasificarEtapaAutomatica()
 */
function extraerSenalesDesdeContexto(contexto, etapaActual) {
  const alertas = contexto?.alertas || [];
  return {
    clienteRespondioAlBot: alertas.includes("cliente_respondio_al_bot"),
    cuentaBancariaEnviada: contexto?.comercial?.cuenta_bancaria_enviada === true ||
                           alertas.includes("cuenta_bancaria_enviada"),
    anticipoConfirmado:    contexto?.comercial?.anticipo_confirmado === true,
    etapaActual,
  };
}

/**
 * Detecta si un mensaje aprobado contiene datos bancarios.
 * Usado para capturar la transición seguimiento → negociacion en tiempo real,
 * como red de seguridad cuando el supervisor olvidó setear nueva_etapa.
 *
 * @param {string} mensaje — Texto del mensaje aprobado por QA
 * @returns {boolean}
 */
function mensajeContieneDatosBancarios(mensaje) {
  if (!mensaje) return false;
  return (
    mensaje.includes("Erika Díaz") ||
    mensaje.includes("MARKETAS") ||
    /\d{10,}/.test(mensaje)
  );
}

module.exports = {
  clasificarEtapaAutomatica,
  extraerSenalesDesdeContexto,
  mensajeContieneDatosBancarios,
};
