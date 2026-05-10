#!/bin/bash
# Setup inicial — Sistema 360 Eventos

echo "🚀 Configurando Sistema de Ventas 360 Eventos..."

# Crear package.json
cd "$(dirname "$0")/.."
cat > package.json << 'EOF'
{
  "name": "360-eventos-ventas",
  "version": "1.0.0",
  "description": "Sistema de ventas automatizado 360 Eventos",
  "main": "scripts/servidor.js",
  "scripts": {
    "start": "node scripts/servidor.js",
    "dev": "nodemon scripts/servidor.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.0"
  }
}
EOF

echo "✓ package.json creado"

# Instalar dependencias
npm install
echo "✓ Dependencias instaladas"

# Crear archivo .env de ejemplo
cat > .env.example << 'EOF'
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Evolution API
EVOLUTION_API_URL=https://tu-instancia.evolution.com
EVOLUTION_API_KEY=tu-api-key
EVOLUTION_INSTANCE=360eventos

# EspoCRM
ESPOCRM_URL=https://tu-crm.com
ESPOCRM_API_KEY=tu-api-key

# Base de datos
DATABASE_URL=postgresql://user:pass@host:5432/360eventos

# Alertas
WA_COORDINADOR=+57...

# Servidor
PORT=3001
EOF

echo "✓ .env.example creado — copia a .env y configura tus credenciales"
echo ""
echo "📋 Próximos pasos:"
echo "  1. cp .env.example .env"
echo "  2. Editar .env con tus credenciales"
echo "  3. Implementar las funciones en agentes/ciclo_supervisor.js:"
echo "     - obtenerLeadsActivos() → EspoCRM"
echo "     - obtenerHistorialLead() → PostgreSQL"
echo "     - enviarMensajeWhatsApp() → Evolution API"
echo "     - actualizarLeadCRM() → EspoCRM"
echo "  4. npm start"
echo "  5. Importar workflows en n8n"
echo ""
echo "✅ Setup completado"
