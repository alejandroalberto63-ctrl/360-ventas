/**
 * Verifica conexión de la instancia 360eventos en Evolution API
 * Ejecutar: node scripts/verificar_conexion.js
 */

const EVOLUTION_URL = "https://marketa-evolution-api.hoqkyr.easypanel.host";
const EVOLUTION_KEY = "C7A48B3A1DEC-43C7-BE25-66431EE6F47B";
const INSTANCE = "360eventos";

async function main() {
  console.log(`\nVerificando instancia "${INSTANCE}" en Evolution API...`);

  const res = await fetch(`${EVOLUTION_URL}/instance/connectionState/${INSTANCE}`, {
    headers: { apikey: EVOLUTION_KEY },
  });

  if (!res.ok) {
    console.log(`❌ Error HTTP ${res.status}: ${await res.text()}`);
    return;
  }

  const data = await res.json();
  console.log(`\nEstado: ${JSON.stringify(data, null, 2)}`);

  const estado = data?.instance?.state;
  if (estado === "open") {
    console.log(`\n✅ Instancia conectada y lista`);
  } else {
    console.log(`\n⚠️  Estado: ${estado} — revisar conexión en Evolution API`);
  }
}

main().catch(console.error);
