# Reglas de Interacción para Agentes de IA

<!-- BEGIN:nextjs-agent-rules -->
This is NOT the Next.js you know — APIs, conventions, and file structure may differ. Read `node_modules/next/dist/docs/` before writing code.
<!-- END:nextjs-agent-rules -->

## 🚨 Lógica Core del Webhook — NO MODIFICAR sin preguntar

El archivo `src/app/api/webhook/route.ts` es crítico. Preguntar antes de cualquier cambio.

### Reglas que deben mantenerse intactas:

1. **Anti-Duplicación Atómica:** `runTransaction` sobre `dedup/{msgId}`. Solo el primer request pasa; el resto se descarta.
2. **Toggle AI:** Si `oldChat.aiEnabled === false`, la IA se bloquea por completo pero el mensaje del usuario sí se guarda.
3. **Flujo de 3 Imágenes (Throttling):**
   - Imágenes se detectan como `type === 'image' | 'sticker'` o contenido `[Imagen]`.
   - Transacción en `chats/{chatId}/imageCount`.
   - Imagen 1 y 2: Sonia se queda callada (`shouldCallAI = false`).
   - Al llegar a 3+: contador se reinicia a 0, se inyecta a Gemini: `[Sistema: El usuario ha enviado 3 imagenes. Ahora debe pedir los datos personales y bancarios.]`
4. **Debounce Lock (1.5s):** Tras pasar imágenes/dedup, se adquiere un lock atómico en `locks/{chatId}`. Si se obtiene, espera 1.5s para acumular mensajes rápidos y llama a Gemini UNA VEZ con todo el batch. Si no se obtiene, guarda el mensaje y retorna. TTL de 10s por si el lock-holder crashea.
5. **Cero Candados de Tiempo:** No hay bloqueos artificiales de 15/30 segundos que interfieran con el envío de imágenes.

## Arquitectura del Proyecto

### API Routes
| Ruta | Rol |
|---|---|
| `api/webhook/route.ts` | Receptor WHAPI + orquestador IA (dedup, Gemini, envío, extracción automática) |
| `api/db/route.ts` | Bridge REST para el dashboard (CRUD chats, messages, prompts, casos) |
| `api/whatsapp/send/route.ts` | Envío manual de mensajes (usado por ChatArea) |
| `api/ai/respond/route.ts` | IA genérica + envío (independiente, no usa el prompt de Sonia) |
| `api/systemPrompt/route.ts` | GET/POST para `system/prompt` (duplicado de `db/route.ts`) |

### Firebase RTDB — Paths críticos
- `dedup/{msgId}` — dedup atómico
- `messages/{chatId}/{msgId}` — mensajes
- `chats/{chatId}` — metadatos (phone, name, aiEnabled, imageCount, etc.)
- `system/prompt` — prompt personalizado de Sonia (opcional)
- `casos_reembolso/{chatId}` — casos de reembolso extraídos automáticamente
- `casos_atencion/{chatId}` — casos unificados (FALLA_ALQUILER, CUPON_CHARGE_GO, REEMBOLSO, PUBLICIDAD_DOOH, ESTACION_GRATIS, ESTACION_EVENTO, AGENTE_HUMANO)

### Cadena del System Prompt
1. Webhook intenta leer `system/prompt` de Firebase
2. Si no existe, usa la constante `SYSTEM_PROMPT` hardcodeada en `webhook/route.ts`
3. El dashboard puede leer/escribir `system/prompt` vía `SystemPromptModal`
4. Si el prompt en Firebase está desactualizado, Sonia no sigue las últimas instrucciones

### Extracción Automática de Casos de Reembolso
- Se activa SOLO si el reply de la IA contiene `"tu caso ha sido registrado"` (o `"caso registrado"`)
- Hace una segunda llamada a Gemini para extraer datos de los últimos 15 mensajes
- Valida que el número de cuenta tenga **exactamente 20 dígitos** antes de guardar
- Guarda en `casos_reembolso/{chatId}` con `estado_caso: 'pendiente_validacion'`

### Firebase Rules — Gotcha conocido
Para poder leer listas (`chats/`, `messages/`, `casos_reembolso/`, `casos_atencion/`), se necesita `".read": true` a nivel del padre, no solo en el wildcard `$chatId`.
El path `locks/{chatId}` también debe estar en las reglas (`.read` + `.write`) para que el debounce lock funcione.
⚠️ Incidente 15/09/2026: el modal Casos Atención daba HTTP 500 porque las rules publicadas NO tenían el nodo `casos_atencion` (se creó con el código nuevo y nunca se agregó). Todo lo demás cargaba (chats 60KB, reembolsos 40KB). Fix: agregar `"casos_atencion": { ".read": true, "$chatId": { ".write": true } }` y Publish. Los casos generados mientras faltaba la rule NO se recuperan (el webhook falla en silencio y avisa ID igual).

## Infraestructura — Proyecto Firebase y Vercel de Sonia (verificado 15/09/2026)
- **Firebase (base viva): proyecto `nova-tech-ai-a78bc`**, instancia `nova-tech-ai-a78bc-default-rtdb` (us-central1).
  Host REST: `https://nova-tech-ai-a78bc-default-rtdb.firebaseio.com`. Verificado en el bundle de producción (`/_next/static/chunks/app/page-*.js` contiene ese host) y por REST: `chats` 200 (206 claves), `casos_reembolso` 200 (72 claves).
- **Proyectos que NO usa Sonia:** `nova-tech-agent` (sus rules de prueba vencieron el 04/07/2026, DB cerrada) y `voltajevzla-25454` (solo visible con la cuenta voltajevzla@gmail.com).
- **Vercel:** scope `alejandro-rodriguezs-projects-7f9b525c`, proyecto `agent-whats-app`, prod `https://agent-whats-app.vercel.app`. Diagnóstico rápido sin secrets: `GET /api/db?action=getChats` debe dar 200; si `getCasosAtencion` da 500, es rules.
- CLIs en esta máquina: `vercel` logueado como `ale061191`; `firebase` logueado como `voltajevzla@gmail.com` (ese login SOLO ve `voltajevzla-25454`, NO ve `nova-tech-ai-a78bc`). `firebase login` no funciona en shell no-interactiva.

## Comandos
```bash
npm run dev      # servidor de desarrollo
npm run build    # build production
npm run start    # iniciar production
npm run lint     # ESLint
```

No hay tests configurados. El deploy es automático via Vercel al hacer push a `main`.

## Variables de Entorno (no trackeadas en git)
```
WHAPI_TOKEN, GOOGLE_API_KEY,
NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
NEXT_PUBLIC_FIREBASE_DATABASE_URL, NEXT_PUBLIC_FIREBASE_PROJECT_ID,
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
NEXT_PUBLIC_FIREBASE_APP_ID
```
WHAPI base URL hardcodeada: `https://gate.whapi.cloud`

## Notas
- `CLAUDE.md` solo contiene `@AGENTS.md`
- El proyecto usa `tailwindcss v4` con PostCSS
- El SDK de Firebase es el de cliente (`firebase`) en TODAS partes, incluso server-side (no usa `firebase-admin`)
- `agentWhatsApp-main/` en la raíz es una copia duplicada anidada — ignorar

---

## Registro de Sesiones de Desarrollo

### Sesión 15/09/2026 — Optimización completa del agente Sonia (cierre fuerte)

**Resumen ejecutivo:** Se optimizó el flujo del agente WhatsApp de Sonia: se corrigieron bugs críticos de routing, se añadieron capas de validación/metrics, se arreglaron reglas de Firebase, y se mejoró significativamente la UI del modal de Casos Atención.

---

#### A. Validación Secundaria con LLM
- **Archivo:** `src/lib/validacion-secundaria.ts` (nuevo)
- **Qué hace:** Función `validarExtraccionEvento`, `validarExtraccionPublicidad`, `buildSecondaryValidationPrompt`, `buildAuditEntry`, `buildCierreEmpatico`, `violaGuardrail`.
- **Integrado en:** `src/app/api/webhook/route.ts` — se ejecuta en los flujos de publicidad y evento (best-effort try/catch para no bloquear el flujo principal).

#### B. Dashboard de Métricas
- **Archivo:** `src/app/api/db/route.ts` — nueva función `getMetricasAtencion` que retorna: total, porTipo, porEstado, porDia (últimos 7 días).
- **UI:** `src/components/CasosAtencionModal.tsx` — botón toggle "Ver métricas", chips por tipo, mini gráfico de barras por día.

#### C. Normalización + Guardrails + Cierres Empáticos
- **Archivo:** `src/lib/normalizacion.ts` (nuevo) — `normalizeFechaES` (acepta DD/MM/YYYY, "20 sep 2026", "20nde septiembre", hoy/mañana), `normalizeMontoBs` ("12.000Bs", "12mil", "doce mil"), `extractMontoRobusto`.
- **`src/lib/monto.ts`** ahora importa `normalizeMontoBs` como primer paso antes del fallback legacy.
- **Flujo del webhook:** Todos los 4 flujos (publicidad, gratis, evento, humano) ahora usan `buildCierreEmpatico` con recap.

#### D. Fix Montalbán-1 (detección numérica)
- **Archivo:** `src/lib/menu.ts` — `detectFlow` ahora solo acepta `^[1-7]$` como opción numérica. "montalbán 1" ya no dispara opción 1.

#### E. Blindaje waitingFor
- El campo `waitingFor` del estado no cambia mid-capture a menos que:
  - El usuario elija explícitamente una opción del menú, o
  - Se detecte que el usuario está stuck en `monto_exacto`.
- Se preservan parciales (`...estadoActual`) al re-persistir state en cada re-intento de captura.

#### F. Normalización de Keywords
- Eliminadas palabras sueltas que causaban falsos positivos: `persona` (agente_humano), `fecha`/`asistentes` (evento), `otra`/`info` (otra_consulta).
- `otra_consulta` ahora requiere frase explícita o texto corto (<35 chars).

#### G. Anti-Hijack en Reembolso
- Flujo `otra_consulta` ignorado durante estados `reembolso`/`1200_error`/`monto_exacto` a menos que se use frase explícita.
- **Tracker anti-redundancia reembolso:** Extrae cuenta20, banco, teléfono, monto, fecha, posible cédula del historial completo → guarda en `estado.reembolsoData` → inyecta prompt `DATOS YA RECIBIDOS (NO volver a pedirlos)`. El formato del recap NO se modificó (decisión del CEO).

#### H. Fix persist() — preservación de parciales
- `src/app/api/webhook/route.ts` — el `update` final ahora hace `...estadoActual, flow: ...` en vez de reemplazar todo el objeto `estado` (lo cual borraba parciales capturados).

#### I. Extracción de Eventos mejorada
- `normalizeFechaES` se aplica ANTES del regex de fallback en el webhook.
- Tolerancia a typos: `20nde` → `20 de`.
- Soporte para rangos de asistentes: `200-300`.
- Palabras clave expandidas: carro, auto, expo, lanzamiento.

#### J. Extracción Negocio/Zona
- Separación por coma / "y me ubico".
- Helpers `cleanNegocio` / `cleanZona` para deduplicar zona del final del nombre del negocio.

#### K. API Endpoints nuevos en `src/app/api/db/route.ts`
- `updateCasoAtencion` — actualiza campos de un caso (estado, etc.).
- `deleteCasoAtencion` — elimina un caso de Firebase (antes el botón "Eliminar" solo borraba del state local).

#### L. Firebase Rules — fix Incidente 15/09/2026
- **Problema:** El modal Casos Atención daba HTTP 500 porque las rules publicadas NO tenían el nodo `casos_atencion` (se creó con código nuevo y nunca se agregó). Todo lo demás cargaba bien.
- **Fix:** Agregar `"casos_atencion": { ".read": true, "$chatId": { ".write": true } }` al archivo de rules en `nova-tech-ai-a78bc` y Publicar.
- **Verificación:** REST `GET /casos_atencion.json` → 200; `getCasosAtencion` en la app → 200; `getMetricasAtencion` → 200.
- **Nota:** Los casos generados mientras faltaba la rule NO se recuperan (el webhook falla en silencio y avisa el ID del caso igualmente).

#### M. Modal CasosAtención — UI/UX
- **Fix "Invalid Date":** Se agregó `parseFechaCaso()` que parsea `DD/MM/YYYY HH:MM` (formato guardado por el webhook) correctamente. `new Date()` no lo hacía. Esto también arreglo el ordenamiento y los filtros por fecha.
- **Check de Atendido:** Nueva columna ATENDIDO con toggle optimista (igual al modal de reembolsos). Al marcar: estado cambia a "Atendido" (pill verde ✅), métricas se actualizan al instante, reversión si falla la red.
- **Espaciados métricas:** Cards más anchas (min 150px), padding generoso (16px 22px), número más grande (text-2xl), chips y barras con más breathing room.
- **Footer:** "Mostrando X–Y de Z casos" + leyenda de Atendido.
- **Excel:** Ahora exporta columna Atendido (Sí/No).

#### N. Documentación `AGENTS.md`
- Se agregó la sección de Infraestructura (proyecto Firebase, Vercel scope, gotchas, diagnóstico rápido).
- Se documentó la ruta `casos_atencion` en Firebase RTDB paths críticos.
- Se documentó el incidente 15/09/2026 de Firebase rules.

---

#### Commits (orden cronológico)
| Hash | Mensaje |
|---|---|
| `15b146f` | `feat: optimizacion A-B-C validacion secundaria, metricas, normalizacion y cierres empaticos` |
| `5902790` | `fix: montalban-1 falso menu, blindaje waitingFor, preserva parciales, fecha typo y keywords` |
| `21c4241` | `fix: anti-secuestro flujo 7, tracker anti-redundancia reembolso, error visible modal` |
| `b018ee2` | `feat: modal Atendido toggle, fix Invalid Date, espaciados metricas, API delete real` |

#### Archivos modificados/creados
- `src/lib/normalizacion.ts` — **nuevo** (normalización de fechas, montos)
- `src/lib/validacion-secundaria.ts` — **nuevo** (validación LLM secundaria, cierres empáticos, audit)
- `src/lib/monto.ts` — importa `normalizeMontoBs`
- `src/lib/menu.ts` — `detectFlow` numérico hardcodeado `^[1-7]$`
- `src/app/api/webhook/route.ts` — todas las integraciones (validación, blindaje, parciales, tracker, keywords)
- `src/app/api/db/route.ts` — `getMetricasAtencion`, `updateCasoAtencion`, `deleteCasoAtencion`
- `src/components/CasosAtencionModal.tsx` — métricas, check atendido, fix date, espaciados, footer
- `AGENTS.md` — infra docs, path `casos_atencion`, incidente 15/09

#### Decisiones clave de negocio (CEO)
- Formato del recap de reembolso: NO cambiar (mantener ID, TIPO, Fecha, Usuario, Cédula, Teléfono, Cuenta, Ubicación, Monto, Observaciones, Estado).
- Cierres empáticos con recap en flows 3-6.
- Paso de confirmación "¿Te leí así…?" antes de finalizar.
- Tracker anti-redundancia para reembolso (prompt injection de datos ya recibidos).
