# 🔍 Diagnóstico: Agente WhatsApp - Respuestas no llegan

## Resumen del problema
Las respuestas del agente AI (SONIA) se generan correctamente y se guardan en Firebase (por eso las ves en tu sistema), pero **NO llegan al WhatsApp del usuario** porque los mensajes se envían con un formato incorrecto a la API de WHAPI.

---

## 🐛 Bugs encontrados y corregidos

### Bug #1: Formato incorrecto del campo `to` (CAUSA PRINCIPAL)
**Archivo:** `src/app/api/webhook/route.ts`

La API de WHAPI requiere que el campo `to` tenga el formato `phone@s.whatsapp.net`, pero el código enviaba solo el número sin sufijo:

```diff
- body: JSON.stringify({ to: chatId, body: reply })
+ body: JSON.stringify({ to: chatId + '@s.whatsapp.net', body: reply })
```

> [!CAUTION]
> Este era el bug principal. Sin el sufijo `@s.whatsapp.net`, WHAPI no puede entregar el mensaje.

### Bug #2: Truncamiento del número de teléfono
**Archivo:** `src/app/api/webhook/route.ts` (línea 25)

```diff
- const chatId = phone.replace(/\D/g, '').slice(-10);
+ const chatId = rawPhone.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '');
```

El código original tomaba solo los últimos 10 dígitos, eliminando el **código de país** (ej: `58` para Venezuela). Esto causaba:
- El chatId guardado no coincidía con el número real
- WHAPI no podía identificar al destinatario

### Bug #3: Endpoint y formato incorrecto en `ai/respond`
**Archivo:** `src/app/api/ai/respond/route.ts`

```diff
- const sendResponse = await fetch(`${WHAPI_BASE_URL}/sendMessage`, {
+ const sendResponse = await fetch(`${WHAPI_BASE_URL}/messages/text`, {
    ...
-   body: JSON.stringify({
-     messaging_product: 'whatsapp',
-     to: phone,
-     text: { body: aiResponse },
-   }),
+   body: JSON.stringify({
+     to: phone + '@s.whatsapp.net',
+     body: aiResponse,
+   }),
```

Problemas:
1. **Endpoint incorrecto**: `/sendMessage` no existe en WHAPI → debe ser `/messages/text`
2. **Formato del body incorrecto**: Usaba formato de la API oficial de Meta (`messaging_product`, `text.body`) en vez del formato de WHAPI (`body`)

### Bug #4: Modelo de Gemini inexistente
**Archivo:** `src/app/api/webhook/route.ts`

```diff
- gemini-2.5-flash:generateContent
+ gemini-2.0-flash:generateContent
```

El modelo `gemini-2.5-flash` no existe en la API. Puede causar errores silenciosos.

### Bug #5: Sin logging de errores
Ninguno de los archivos tenía logging adecuado cuando WHAPI o Gemini fallaban, haciendo imposible diagnosticar el problema.

---

## ✅ Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `src/app/api/webhook/route.ts` | Formato `to` corregido, chatId preserva código de país, modelo Gemini corregido, logging completo |
| `src/app/api/whatsapp/send/route.ts` | Agrega `@s.whatsapp.net` automáticamente, logging |
| `src/app/api/ai/respond/route.ts` | Endpoint corregido a `/messages/text`, formato body corregido, sufijo `@s.whatsapp.net` |

---

## ⚠️ Importante: Datos existentes en Firebase

> [!WARNING]
> Los chats existentes en Firebase pueden tener chatIds truncados (sin código de país). Los nuevos mensajes entrantes crearán chatIds nuevos con el número completo. Es posible que veas chats duplicados temporalmente.

## 🚀 Próximos pasos

1. **Reinicia el servidor** con `npm run dev`
2. **Envía un mensaje de prueba** desde WhatsApp
3. **Revisa los logs** de la consola del servidor para ver los mensajes `[WHAPI]` confirmando envío
4. Si estás en producción (Vercel, etc.), **re-despliega** el proyecto
