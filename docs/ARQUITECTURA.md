# Sistema de Ventas 360 — Arquitectura Completa

## Visión General

Sistema de ventas automatizado con IA para gestión de leads, seguimiento y cierre.
Incluye un **Agente de Control (QA)** que revisa cada mensaje antes de enviarlo al cliente.

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Mensajería | Evolution API (WhatsApp) |
| Automatización | n8n |
| CRM | EspoCRM |
| IA Agente Ventas | Claude (claude-sonnet-4-6) |
| IA Agente QA | Claude (claude-sonnet-4-6) |
| Base de datos contexto | PostgreSQL / Supabase |
| Panel de control | n8n + EspoCRM |

---

## Flujo del Embudo 360

```
[LEAD ENTRA]
     │
     ▼
[CAPTURA] ────────────────────────────────────────────
     │  Formulario web / Link / WhatsApp directo       
     │  → Registro en EspoCRM                          
     │  → Asignar ID único al lead                     
     ▼
[ETAPA 1 — BIENVENIDA]
     │  Agente Ventas genera mensaje de bienvenida
     │  → Agente QA revisa → APRUEBA/RECHAZA
     │  → Evolution API envía mensaje
     ▼
[ETAPA 2 — CALIFICACIÓN]
     │  Bot hace preguntas clave (presupuesto, fecha evento, tipo)
     │  → Respuestas guardadas en contexto CRM
     │  → Score de calificación calculado
     ▼
[ETAPA 3 — PROPUESTA]
     │  Agente Ventas genera propuesta personalizada
     │  → Agente QA revisa tono, precio, datos
     │  → Envío automático con PDF adjunto
     ▼
[ETAPA 4 — SEGUIMIENTO]
     │  Si no responde en 24h → mensaje de seguimiento
     │  Si no responde en 48h → mensaje urgencia
     │  Si no responde en 72h → escalado a humano
     ▼
[ETAPA 5 — CIERRE]
     │  Link de pago / Contrato
     │  → Confirmación automática
     │  → Onboarding del evento
```

---

## Arquitectura de Agentes

### Agente 1 — VENTAS (Generador)
- **Rol**: Genera respuestas, propuestas y mensajes de seguimiento
- **Contexto que lee**: Historial completo del lead, etapa del embudo, datos del evento
- **Modelo**: claude-sonnet-4-6
- **Prompt base**: `/prompts/agente_ventas.md`

### Agente 2 — QA (Controlador) ← CLAVE
- **Rol**: Revisa CADA mensaje antes de enviarlo
- **Verifica**:
  - Tono correcto (profesional, cálido)
  - Datos del cliente correctos (nombre, fecha, tipo evento)
  - Precio/propuesta coherente con lo discutido
  - Sin errores gramaticales
  - No contradice mensajes anteriores
  - Cumple con la etapa del embudo
- **Output**: `APRUEBA` (mensaje pasa) | `RECHAZA + corrección` (regresa al Agente Ventas)
- **Modelo**: claude-sonnet-4-6
- **Prompt base**: `/prompts/agente_qa.md`

### Agente 3 — CONTEXTO (Memoria)
- **Rol**: Extrae y resume el contexto del lead para alimentar a los otros agentes
- **Lee**: Últimos N mensajes + ficha CRM + etapa actual
- **Output**: JSON estructurado con contexto

---

## Flujo Interno de un Mensaje

```
[Trigger: respuesta del cliente o timer de seguimiento]
         │
         ▼
[Agente Contexto] ── lee historial ──► JSON contexto
         │
         ▼
[Agente Ventas] ── genera respuesta con contexto ──► Borrador mensaje
         │
         ▼
[Agente QA] ── revisa borrador
         │
    ┌────┴────┐
  APRUEBA  RECHAZA
    │          │
    │       [Agente Ventas] reformula (máx 3 intentos)
    │          │
    ▼          ▼ (si 3 intentos fallidos → alerta humano)
[Evolution API] envía mensaje
         │
         ▼
[EspoCRM] actualiza historial + etapa
```

---

## Estructura de Carpetas

```
360 eventos/
├── docs/
│   ├── ARQUITECTURA.md          ← este archivo
│   ├── ETAPAS_EMBUDO.md         ← detalle de cada etapa
│   └── CONFIGURACION.md         ← variables de entorno
├── workflows/
│   ├── 01_captura_lead.json     ← n8n: entrada de nuevo lead
│   ├── 02_calificacion.json     ← n8n: preguntas de calificación
│   ├── 03_propuesta.json        ← n8n: generación de propuesta
│   ├── 04_seguimiento.json      ← n8n: timers de seguimiento
│   ├── 05_cierre.json           ← n8n: proceso de cierre
│   └── 00_router_central.json   ← n8n: router principal de mensajes
├── agentes/
│   ├── agente_ventas.js         ← lógica Agente Ventas
│   ├── agente_qa.js             ← lógica Agente QA
│   └── agente_contexto.js       ← lógica Agente Contexto
├── prompts/
│   ├── agente_ventas.md         ← system prompt ventas
│   ├── agente_qa.md             ← system prompt QA
│   └── agente_contexto.md       ← system prompt contexto
├── crm/
│   └── campos_espocrm.md        ← campos necesarios en EspoCRM
└── scripts/
    └── setup.sh                 ← script de configuración inicial
```

---

## Base de Datos de Contexto (por Lead)

```json
{
  "lead_id": "uuid",
  "nombre": "Juan Pérez",
  "telefono": "+57...",
  "etapa_actual": "propuesta",
  "fecha_ultimo_contacto": "2026-05-08T10:00:00",
  "datos_evento": {
    "tipo": "cumpleaños / boda / empresarial",
    "fecha_evento": "2026-06-15",
    "num_personas": 80,
    "presupuesto_aprox": 5000000,
    "ciudad": "Bogotá"
  },
  "score_calificacion": 85,
  "historial_mensajes": [...],
  "intentos_seguimiento": 0,
  "asignado_a": "bot | humano",
  "notas_internas": ""
}
```

---

## Reglas del Agente QA

El QA rechaza el mensaje si detecta cualquiera de estas condiciones:

1. Nombre del cliente incorrecto o ausente cuando debe incluirse
2. Precio diferente al discutido previamente
3. Fecha de evento incorrecta
4. Tono inapropiado (muy frío, muy urgente fuera de contexto)
5. Mensaje contradice algo dicho en mensajes anteriores
6. Incluye información de otro lead (datos cruzados)
7. Etapa incorrecta (ej: enviar propuesta antes de calificar)
8. Errores ortográficos graves
9. Mensaje demasiado largo para WhatsApp (>800 caracteres sin estructura)

---

## Timers de Seguimiento

| Tiempo sin respuesta | Acción |
|---------------------|--------|
| 24 horas | Mensaje suave de seguimiento |
| 48 horas | Mensaje con propuesta de valor + urgencia leve |
| 72 horas | Mensaje final + escalado a humano en EspoCRM |
| 7 días | Mensaje de reactivación / descuento |
| 30 días | Archivo del lead (inactivo) |

---

## Próximos Pasos

- [ ] Configurar EspoCRM con campos del evento
- [ ] Crear workflows n8n (empezar por `00_router_central`)
- [ ] Escribir system prompts de cada agente
- [ ] Conectar Evolution API con n8n
- [ ] Probar ciclo completo con lead de prueba
- [ ] Ajustar prompts con base en resultados QA
