# Etapas del Embudo 360 — Detalle Operativo

## Etapa 0: CAPTURA
**Trigger**: Lead llega por primera vez (WhatsApp, formulario web, QR en evento)

**Acciones automáticas**:
1. Crear registro en EspoCRM con: teléfono, fuente, timestamp
2. Asignar ID único
3. Iniciar conversación → pasar a Etapa 1

**n8n Workflow**: `01_captura_lead.json`

---

## Etapa 1: BIENVENIDA
**Trigger**: Lead creado / primer mensaje recibido

**Instrucción al Agente de Ventas**:
> "Saluda al cliente, preséntate como Ana de 360 Eventos, y haz 1-2 preguntas para entender qué tipo de evento están buscando organizar."

**Respuesta esperada del lead**: Tipo de evento, contexto general

**Condición de avance**: Lead responde con algún detalle del evento

**n8n**: Timer de 24h si no responde → seguimiento

---

## Etapa 2: CALIFICACIÓN
**Trigger**: Lead respondió en Bienvenida

**Instrucción al Agente de Ventas**:
> "Recopila los datos del evento: tipo exacto, fecha, número de personas, ciudad y presupuesto aproximado. Hazlo de forma conversacional, no como un formulario."

**Datos a recopilar**:
- Tipo de evento (boda, empresarial, cumpleaños, etc.)
- Fecha estimada del evento
- Número de personas / invitados
- Ciudad o lugar preferido
- Presupuesto aproximado (rango)

**Score de calificación**:
- Presupuesto definido: +30 pts
- Fecha definida: +25 pts
- Número de personas claro: +20 pts
- Ciudad/lugar claro: +15 pts
- Tipo de evento claro: +10 pts
- Score ≥ 70: Lead calificado → avanzar a Propuesta
- Score < 70: Continuar calificando

**n8n Workflow**: `02_calificacion.json`

---

## Etapa 3: PROPUESTA
**Trigger**: Lead calificado (score ≥ 70)

**Instrucción al Agente de Ventas**:
> "Con base en los datos recopilados, presenta una propuesta personalizada. Menciona los servicios de 360 Eventos que aplican, un rango de precio aproximado y propón un siguiente paso (reunión, visita al espacio, envío de propuesta formal por email)."

**Acciones adicionales**:
- Generar y adjuntar PDF de propuesta (si está configurado)
- Enviar link de calendario para agendar reunión

**Condición de avance**: Lead acepta reunión o pide más detalles → Seguimiento activo

**n8n Workflow**: `03_propuesta.json`

---

## Etapa 4: SEGUIMIENTO
**Trigger**: Enviada propuesta sin respuesta, o lead en proceso de decisión

**Timer automático**:
- 24h sin respuesta → mensaje suave
- 48h sin respuesta → mensaje con valor agregado
- 72h sin respuesta → mensaje final + alerta a equipo humano

**Instrucción al Agente de Ventas (24h)**:
> "El cliente vio la propuesta hace 24 horas y no ha respondido. Envía un mensaje cálido preguntando si tiene dudas sobre la propuesta, referenciando el evento específico."

**Instrucción al Agente de Ventas (48h)**:
> "Han pasado 48 horas. Agrega valor: menciona un testimonio corto de un evento similar o una ventaja adicional. Crea urgencia leve (disponibilidad de fechas)."

**Instrucción al Agente de Ventas (72h)**:
> "Mensaje final del bot. Informa que el equipo está disponible para hablar personalmente. Genera alerta de escalado humano en CRM."

**n8n Workflow**: `04_seguimiento.json`

---

## Etapa 5: CIERRE
**Trigger**: Lead confirma que quiere proceder

**Instrucción al Agente de Ventas**:
> "El cliente confirmó interés. Resume los detalles acordados, envía el link de pago/anticipo y explica los siguientes pasos del proceso de organización del evento."

**Acciones automáticas**:
- Actualizar EspoCRM: estado → "Cliente"
- Crear tarea de onboarding
- Enviar confirmación con resumen del evento

**n8n Workflow**: `05_cierre.json`

---

## Etapa 6: REACTIVACIÓN (30 días inactivo)
**Trigger**: Lead sin actividad por 30 días

**Instrucción al Agente de Ventas**:
> "El cliente estuvo interesado hace 30 días en organizar [tipo de evento]. Envía un mensaje de reactivación mencionando una novedad o promoción actual."

**Si no responde**: Marcar como "Inactivo" en CRM, salir del embudo activo

---

## Estados del Lead en CRM

| Estado | Descripción |
|--------|-------------|
| `nuevo` | Recién capturado |
| `calificando` | En proceso de recopilar datos |
| `calificado` | Score ≥ 70, listo para propuesta |
| `propuesta_enviada` | Propuesta enviada, esperando respuesta |
| `seguimiento_activo` | En ciclo de seguimiento |
| `escalado_humano` | Requiere atención del equipo |
| `cliente` | Cerrado exitosamente |
| `inactivo` | Sin respuesta prolongada |
| `perdido` | Descartado explícitamente |
