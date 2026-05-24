# Reglas de Interacción para Agentes de IA

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 🚨 MANDATOS ESTRICTOS SOBRE LA LÓGICA CORE (NO MODIFICAR) 🚨

La lógica central del Webhook (`src/app/api/webhook/route.ts`) es altamente estable y sensible a tiempos de ejecución y bloqueos. **ANTES de proponer CUALQUIER cambio a este archivo, el agente debe preguntar EXPLÍCITAMENTE al usuario si desea modificar la lógica base que ya funciona.**

Si el usuario responde que **NO**, el agente debe implementar las nuevas funcionalidades (nuevos endpoints, UI, etc) **SIN TOCAR, ALTERAR O DAÑAR** lo que ya funciona en el Webhook.

### 📜 Lógica Base Actual (Funcionando Perfecto - NO TOCAR):

1. **Anti-Duplicación Atómica:** Se utiliza `runTransaction` sobre la ruta `dedup/{msgId}` en Firebase. Sólo el primer request pasa; el resto se descarta para evitar que Sonia responda duplicado a los reenvíos de la API de WHAPI.
2. **Toggle AI (Encendido/Apagado):** El webhook respeta estrictamente la bandera `oldChat.aiEnabled === false`. Si es falso, la IA se detiene por completo (se bloquea la llamada a Gemini), pero el mensaje del usuario sí se guarda.
3. **Flujo de 3 Imágenes (Throttling):**
   - El sistema detecta cuando entran imágenes (`type === 'image' || 'sticker'` o `[Imagen]`).
   - Se utiliza una transacción en `chats/{chatId}/imageCount` para ir contando.
   - En la imagen 1 y 2: Sonia **SE QUEDA CALLADA** (`shouldCallAI = false`).
   - Al llegar a 3 o más: El contador se reinicia a 0, `shouldCallAI` vuelve a `true`, y el sistema le inyecta internamente a Gemini el texto: `[Sistema: El usuario ha enviado 3 imagenes. Ahora debe pedir los datos personales y bancarios.]`
4. **Cero Candados de Tiempo (No Time Locks):** Se eliminaron **TODOS** los candados de tiempo artificiales (los que bloqueaban por 15 o 30 segundos) porque interferían con el envío simultáneo de imágenes por parte del usuario, causando fallos silenciosos. Gemini se procesa de forma síncrona si pasa la barrera de las imágenes o dedup.

Cualquier mejora futura debe construirse *alrededor* de estas reglas, no reemplazándolas.