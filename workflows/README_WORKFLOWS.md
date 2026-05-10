# Workflows n8n — 360 Eventos

Importar en: `marketa-n8n-kommo.hoqkyr.easypanel.host`

---

## Workflow 00 — Entrada Mensajes WhatsApp
**Archivo**: `00_entrada_mensajes.json`
**Trigger**: Webhook Evolution API → path `/360-entrada`

```
POST /360-entrada (Evolution API)
  → Responder 200 inmediatamente
  → Filtrar: solo instancia "360eventos", no grupos, no mensajes propios, tiene texto
  → Buscar contacto en Kommo por teléfono
  → Si no existe → crear lead en pipeline 8699516 (etapa "nuevo")
  → Obtener lead completo + verificar Pausar IA + etapa Reserva
  → Si bot detenido → solo guardar mensaje en LOG
  → Si bot activo → guardar LOG + disparar ciclo supervisor
```

**Configurar en Evolution API**: webhook URL = `https://<n8n-url>/webhook/360-entrada`

---

## Workflow 01 — Ciclo Supervisor (CRON)
**Archivo**: `01_ciclo_supervisor.json`
**Trigger**: Cada 20 minutos

```
Cada 20 min → POST http://localhost:3001/ciclo → Log resultado
```

El servidor Node.js en puerto 3001 ejecuta todo el pipeline de IA:
`Contexto → Supervisor → Agente Etapa → QA → Evolution API → Kommo`

---

## Servidor Express (backend)

Correr con: `npm start` (o `pm2 start scripts/servidor.js`)

| Endpoint | Descripción |
|----------|-------------|
| `POST /ciclo` | Ejecuta ciclo completo del supervisor |
| `POST /ciclo?lead_id=X` | Ciclo con prioridad en lead X |
| `GET /status` | Estado actual del sistema |
| `GET /reporte` | Último reporte de ciclo |
| `POST /webhook/360` | Webhook alternativo directo (sin n8n) |

---

## Credencial n8n requerida: Kommo Auth

En n8n → Credentials → HTTP Header Auth:
- **Name**: `Kommo Auth`
- **Header Name**: `Authorization`
- **Header Value**: `Bearer <KOMMO_ACCESS_TOKEN>`

---

## Variables .env del servidor

```
OPENAI_API_KEY=          # OpenAI — GPT-4o para todos los agentes
KOMMO_ACCESS_TOKEN=      # JWT de Kommo CRM
EVOLUTION_API_KEY=C7A48B3A1DEC-43C7-BE25-66431EE6F47B
EVOLUTION_API_URL=https://marketa-evolution-api.hoqkyr.easypanel.host
WA_COORDINADOR_360=593980243197   # Erika — alertas escalado
WA_DUENO_360=593996863110         # Alberto — alertas críticas
PORT=3001
```

---

## Orden de activación

1. Agregar `OPENAI_API_KEY` en `.env`
2. `npm install && npm start`
3. Importar `00_entrada_mensajes.json` en n8n → activar
4. Importar `01_ciclo_supervisor.json` en n8n → activar
5. En Evolution API: configurar webhook de instancia `360eventos` → `https://<n8n>/webhook/360-entrada`
6. Probar con `node tests/test_10_clientes.js`
