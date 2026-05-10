const { llamarJSON } = require("./openai_client");
const fs = require("fs");
const path = require("path");

const PROMPT = fs.readFileSync(path.join(__dirname, "../prompts/supervisor.md"), "utf8");

async function evaluarEmbudo(leadsActivos) {
  console.log(`[Supervisor] Evaluando ${leadsActivos.length} leads...`);

  const ahora = new Date();
  const fechaHoy = ahora.toLocaleDateString("es-EC", {
    timeZone: "America/Guayaquil",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const fechaISO = ahora.toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" }); // YYYY-MM-DD

  const user = `FECHA_HOY: ${fechaHoy} (${fechaISO})\n\nEvalúa el estado del embudo y genera el plan de acción:\n\n${JSON.stringify({
    timestamp_ciclo: ahora.toISOString(),
    leads_activos: leadsActivos,
  }, null, 2)}`;

  return llamarJSON(PROMPT, user, { temperature: 0.3, maxTokens: 4096 });
}

module.exports = { evaluarEmbudo };
