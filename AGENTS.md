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
4. **Cero Candados de Tiempo:** No hay bloqueos de 15/30 segundos. Gemini se procesa síncrono si pasa la barrera de imágenes/dedup.

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
Para poder leer listas (`chats/`, `messages/`, `casos_reembolso/`), se necesita `".read": true` a nivel del padre, no solo en el wildcard `$chatId`.

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
