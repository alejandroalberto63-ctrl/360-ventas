# Configuración del Sistema — 360 Eventos

## Variables de Entorno Requeridas

```env
# Anthropic (Agentes IA)
ANTHROPIC_API_KEY=sk-ant-...

# Evolution API (WhatsApp)
EVOLUTION_API_URL=https://tu-instancia.evolution.com
EVOLUTION_API_KEY=tu-api-key
EVOLUTION_INSTANCE=360eventos

# EspoCRM
ESPOCRM_URL=https://tu-crm.com
ESPOCRM_API_KEY=tu-api-key-espocrm

# n8n
N8N_WEBHOOK_BASE=https://tu-n8n.com/webhook

# Base de datos (historial de conversaciones)
DATABASE_URL=postgresql://user:pass@host:5432/360eventos

# Alertas al equipo
SLACK_WEBHOOK_ESCALADO=https://hooks.slack.com/...
# o WhatsApp del coordinador
WA_COORDINADOR=+57...
```

## Flujo de Configuración Inicial

### 1. Configurar Evolution API
1. Crear instancia `360eventos`
2. Configurar webhook → `{N8N_WEBHOOK_BASE}/360-entrada-mensaje`
3. Conectar número de WhatsApp del negocio

### 2. Configurar EspoCRM
1. Crear campos personalizados (ver `crm/campos_espocrm.md`)
2. Crear API Key con permisos de lectura/escritura en Leads
3. Configurar vistas de pipeline

### 3. Importar Workflows n8n
Importar en este orden:
1. `00_router_central.json` — el más importante, enruta todos los mensajes
2. `01_captura_lead.json`
3. `02_calificacion.json`
4. `03_propuesta.json`
5. `04_seguimiento.json`
6. `05_cierre.json`

### 4. Configurar variables en n8n
En cada workflow, actualizar las credenciales de:
- Evolution API
- EspoCRM
- HTTP Request al Pipeline (puerto donde corre agentes/pipeline.js)

### 5. Desplegar agentes Node.js
```bash
cd "360 eventos/agentes"
npm install @anthropic-ai/sdk
# Configurar variables de entorno
node -e "require('./pipeline').ejecutarPipeline" # test de importación
```

## Arquitectura de Red

```
Internet
   │
   ├─► Evolution API (WhatsApp) ──webhook──► n8n
   │                                          │
   └─► Formulario Web ──webhook──► n8n        │
                                              │
                              ┌───────────────┘
                              │
                              ▼
                         n8n Workflows
                              │
                    ┌─────────┼─────────┐
                    │         │         │
                    ▼         ▼         ▼
               EspoCRM   Pipeline    Evolution
               (CRM)     (Agentes)   (envío WA)
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
              Contexto   Ventas (IA)  QA (IA)
              (Claude)   (Claude)    (Claude)
```

## Costos Estimados (mensual)

| Servicio | Costo aprox |
|---------|-------------|
| Anthropic API (Claude) | $20-50 USD según volumen |
| Evolution API | $20-40 USD |
| n8n Cloud | $20 USD |
| EspoCRM Cloud | $15-25 USD |
| **Total estimado** | **$75-135 USD/mes** |
