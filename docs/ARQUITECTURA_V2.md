# Sistema de Ventas 360 — Arquitectura V2 (Supervisor Autónomo)

## Concepto Central

El sistema **no espera** a que llegue un mensaje.
El **Agente Supervisor** despierta cada cierto tiempo, recorre todo el embudo,
piensa qué necesita cada lead, y actúa de forma proactiva.

---

## El Ciclo del Supervisor

```
⏰ TIMER (cada 20-30 min o trigger de mensaje entrante)
         │
         ▼
┌─────────────────────────────────────────────────────┐
│              AGENTE SUPERVISOR                      │
│                                                     │
│  1. Pull todos los leads activos del CRM            │
│  2. Para cada lead → lee contexto completo          │
│  3. Clasifica urgencia y necesidad de acción        │
│  4. Toma decisión: actuar / esperar / escalar       │
│  5. Despacha al agente de etapa correspondiente     │
│  6. Recibe resultado, revisa, actualiza CRM         │
│  7. Genera reporte del ciclo                        │
└─────────────────────────────────────────────────────┘
         │
         ├──► [ENTRANTES SIN ATENDER] ──► Agente Bienvenida
         ├──► [EN CALIFICACIÓN]       ──► Agente Calificación
         ├──► [PROPUESTA PENDIENTE]   ──► Agente Propuesta
         ├──► [EN NEGOCIACIÓN]        ──► Agente Negociación
         ├──► [SIN RESPUESTA X horas] ──► Agente Seguimiento
         ├──► [LISTOS PARA CERRAR]    ──► Agente Cierre
         └──► [CRÍTICOS]              ──► Alerta Humano
                    │
                    ▼ (para cada uno)
         ┌──────────────────────┐
         │  AGENTE DE ETAPA     │ ← lee contexto completo
         │  genera mensaje      │ ← adaptado a este lead
         └──────────────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │    AGENTE QA         │ ← revisa antes de enviar
         │  APRUEBA / RECHAZA   │
         └──────────────────────┘
                    │
          APRUEBA   │   RECHAZA (hasta 3 veces)
             │      │        │
             ▼      │        ▼
         Evolution  │    Corrección + reintento
         API envía  │    Si falla 3 → alerta humano
                    │
                    ▼
               EspoCRM actualizado
```

---

## Los Agentes del Sistema

### 🧠 SUPERVISOR (El Cerebro)
- **Rol**: Piensa como el dueño del negocio. Evalúa TODO el embudo.
- **Pregunta que se hace**: *"¿Qué necesita cada lead hoy para avanzar?"*
- **Decisiones que toma**:
  - ¿Este lead necesita mensaje ahora o es muy pronto?
  - ¿Qué tono usar según su comportamiento?
  - ¿Escalar a humano o puede el bot manejarlo?
  - ¿Prioridad alta o baja?
- **Output**: Lista de acciones ordenadas por prioridad

### 🤝 AGENTE BIENVENIDA
- **Cuándo actúa**: Lead nuevo sin primer contacto, o mensaje entrante sin clasificar
- **Objetivo**: Enganchar, presentar, hacer las primeras preguntas

### 🔍 AGENTE CALIFICACIÓN
- **Cuándo actúa**: Lead en proceso de dar datos del evento
- **Objetivo**: Completar el perfil del lead (tipo, fecha, personas, presupuesto)

### 📋 AGENTE PROPUESTA
- **Cuándo actúa**: Lead calificado, listo para recibir propuesta
- **Objetivo**: Presentar la propuesta correcta de forma convincente

### 💬 AGENTE NEGOCIACIÓN
- **Cuándo actúa**: Lead tiene objeciones (precio, tiempo, comparación con competencia)
- **Objetivo**: Manejar objeciones, generar confianza, ofrecer alternativas

### 📲 AGENTE SEGUIMIENTO
- **Cuándo actúa**: Lead no ha respondido en X horas según su etapa
- **Objetivo**: Reactivar sin molestar, agregar valor real en cada toque

### ✅ AGENTE CIERRE
- **Cuándo actúa**: Lead listo para firmar/pagar
- **Objetivo**: Eliminar fricción final, enviar instrucciones de pago, confirmar

### 🛡️ AGENTE QA (Transversal)
- **Cuándo actúa**: SIEMPRE, antes de CADA mensaje que sale
- **Objetivo**: Cero errores, cero datos cruzados, tono correcto

---

## Lógica de Priorización del Supervisor

El Supervisor ordena los leads así:

### Prioridad URGENTE (actúa primero)
- Lead respondió en los últimos 30 minutos → responder inmediatamente
- Lead escalado a humano sin atender > 2 horas → alerta
- Lead con evento en menos de 15 días → atención inmediata
- Lead que preguntó precio directamente → propuesta en < 1 hora

### Prioridad ALTA (actúa en este ciclo)
- Lead sin respuesta 24h en etapa de propuesta
- Lead calificado pero sin propuesta enviada
- Lead que expresó urgencia ("necesito para el próximo mes")

### Prioridad MEDIA (actúa si hay tiempo)
- Lead en calificación con datos incompletos > 12h
- Seguimiento de 48h pendiente

### Prioridad BAJA (registra, actúa en siguiente ciclo)
- Lead nuevo llegado hace < 2 horas (excepto si ya respondió)
- Lead inactivo en revisión mensual

---

## Diagrama de Estados del Lead

```
[NUEVO] ──► [BIENVENIDA] ──► [CALIFICANDO] ──► [CALIFICADO]
                                                     │
                                              ┌──────┴──────┐
                                              ▼             ▼
                                        [PROPUESTA]   [NEGOCIACIÓN]
                                              │             │
                                              └──────┬──────┘
                                                     ▼
                                              [SEGUIMIENTO]
                                                     │
                                         ┌───────────┼────────────┐
                                         ▼           ▼            ▼
                                      [CIERRE]  [ESCALADO]  [INACTIVO]
                                         │
                                         ▼
                                      [CLIENTE ✓]
```

---

## Reporte del Ciclo (generado por Supervisor)

Cada vez que el Supervisor termina un ciclo, genera:

```
📊 REPORTE CICLO 360 EVENTOS — [fecha/hora]
─────────────────────────────────────────
Leads revisados: 12
Acciones tomadas: 5
Mensajes enviados: 4
Mensajes rechazados por QA: 1 (reintentado OK)
Escalados a humano: 1

🔴 URGENTES atendidos: 2
🟡 ALTOS atendidos: 2  
🟢 MEDIOS atendidos: 1
⏭️ Pospuestos para próximo ciclo: 7

Próximo ciclo: en 20 minutos
```

---

## Stack Tecnológico

| Componente | Tecnología |
|-----------|-----------|
| Scheduler | n8n (cron cada 20min) + webhook entrada |
| Supervisor + Agentes | Node.js + Claude API |
| Mensajería | Evolution API |
| CRM | EspoCRM |
| Historial mensajes | PostgreSQL / Supabase |
| Alertas equipo | WhatsApp (Evolution) o Slack |
| Logs | archivo JSON + dashboard n8n |
