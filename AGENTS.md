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
