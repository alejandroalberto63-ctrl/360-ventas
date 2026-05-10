# Campos EspoCRM — Sistema 360 Eventos

## Entidad: Lead / Prospecto

### Campos Estándar a Usar
| Campo | Tipo | Notas |
|-------|------|-------|
| `firstName` | Text | Nombre del contacto |
| `lastName` | Text | Apellido |
| `mobilePhone` | Phone | WhatsApp principal |
| `status` | Enum | nuevo, calificando, calificado, propuesta_enviada, seguimiento_activo, escalado_humano, cliente, inactivo, perdido |
| `source` | Enum | WhatsApp, Formulario Web, Referido, Instagram, QR Evento |
| `description` | Text Area | Notas internas del equipo |

### Campos Personalizados a Crear (Custom Fields)
| Nombre Campo | ID Campo | Tipo | Descripción |
|-------------|----------|------|-------------|
| Tipo de Evento | `c_tipo_evento` | Enum | boda, empresarial, cumpleaños, grado, quince, otro |
| Fecha del Evento | `c_fecha_evento` | Date | Fecha estimada del evento |
| N° Invitados | `c_num_invitados` | Integer | Número de personas |
| Ciudad Evento | `c_ciudad_evento` | Text | Ciudad o lugar |
| Presupuesto Aprox | `c_presupuesto` | Currency | Presupuesto estimado COP |
| Score Calificación | `c_score` | Integer | 0-100 |
| Etapa Embudo | `c_etapa_embudo` | Enum | bienvenida, calificacion, propuesta, seguimiento, cierre |
| Intentos Seguimiento | `c_intentos_seguimiento` | Integer | Contador de seguimientos |
| Asignado a Bot | `c_bot_activo` | Boolean | true = bot manejando, false = humano |
| Último Contexto IA | `c_contexto_ia` | Text Area | JSON del último contexto generado |
| ID Conversación WA | `c_wa_conversation_id` | Text | ID de sesión Evolution API |

## Entidad: Activity / Tarea Automática

Crear tareas automáticas en EspaCRM cuando:
- Lead escalado a humano → Tarea urgente al equipo de ventas
- Lead cerrado → Tarea de onboarding al coordinador de eventos
- Lead inactivo 30 días → Tarea de revisión mensual

## Vistas Recomendadas

### Vista: Pipeline Activo
Filtro: `status IN [calificando, calificado, propuesta_enviada, seguimiento_activo]`
Orden: `fecha_ultimo_contacto ASC` (más antiguos primero = más urgentes)

### Vista: Escalados a Humano
Filtro: `status = escalado_humano`
Alerta: Notificación push al equipo cuando aparece nuevo registro

### Vista: Cerrados Este Mes
Filtro: `status = cliente AND fecha_cierre >= inicio_mes`
