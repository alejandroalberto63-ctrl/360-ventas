/**
 * Script de diagnóstico — obtiene IDs de etapas y campos del pipeline 360
 * Ejecutar una sola vez: node scripts/get_kommo_ids.js
 */

const TOKEN = process.env.KOMMO_TOKEN;
const SUBDOMAIN = "marketas";
const PIPELINE_ID = "8699516";
const BASE = `https://${SUBDOMAIN}.kommo.com/api/v4`;
const H = { Authorization: `Bearer ${TOKEN}` };

async function main() {
  // Etapas del pipeline
  const r1 = await fetch(`${BASE}/leads/pipelines/${PIPELINE_ID}/statuses`, { headers: H });
  console.log(`\nStatus etapas: ${r1.status}`);
  const d1 = await r1.json();
  if (d1.status === 401) { console.log("❌ Token inválido o expirado"); process.exit(1); }
  console.log("\n=== ETAPAS PIPELINE 360 ===");
  for (const s of d1._embedded?.statuses || []) {
    console.log(`  ${s.name.padEnd(30)} ID: ${s.id}  sort: ${s.sort}`);
  }

  // Campos personalizados de leads
  const r2 = await fetch(`${BASE}/leads/custom_fields`, { headers: H });
  console.log(`\nStatus campos: ${r2.status}`);
  const d2 = await r2.json();
  console.log("\n=== CAMPOS PERSONALIZADOS (leads) ===");
  for (const f of d2._embedded?.custom_fields || []) {
    console.log(`  ${f.name.padEnd(35)} ID: ${f.id}  tipo: ${f.type}`);
  }
}

main().catch(console.error);
