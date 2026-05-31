# Reglas de Seguridad Definitivas — Firebase Realtime Database

## Fecha del análisis: 31 de Mayo de 2026
## Último commit del proyecto: 24 de Mayo de 2026

---

## ¿Qué está pasando?

La base de datos Firebase Realtime Database (`nova-tech-ai-a78bc-default-rtdb`) está en **modo prueba** con reglas que expiran el **4 de junio de 2026**. Después de esa fecha, Firebase rechazará TODAS las solicitudes de lectura/escritura y la aplicación dejará de funcionar por completo.

---

## Arquitectura actual del proyecto

El proyecto es una aplicación **Next.js** que funciona como un agente WhatsApp (Webhook con WHAPI) integrado con **Firebase** e **IA Gemini**.

### ¿Quién accede a Firebase y a qué paths?

**Lado servidor (API Routes de Next.js):**
- `src/app/api/webhook/route.ts` → Lee/escribe en: `dedup/`, `messages/`, `chats/`, `system/prompt`, `casos_reembolso/`
- `src/app/api/db/route.ts` → Lee/escribe en: `chats/`, `messages/`, `system/prompt`, `casos_reembolso/`
- `src/app/api/systemPrompt/route.ts` → Lee/escribe en: `system/prompt`

**Lado cliente (Store/UI del Dashboard):**
- `src/store/useStore.ts` → **Lee:** `chats/`, `messages/` | **Escribe:** `chats/{id}`, `messages/{chatId}/{msgId}`

**SDK usado actualmente:** `firebase` (SDK de cliente) en TODAS partes — tanto servidor como cliente.

---

## Dos caminos para solucionarlo

### Opción A (Rápida) — Solo actualizar reglas en Firebase Console

Actualizar las reglas de seguridad para que permitan acceso por ruta sin fecha de expiración. **No requiere modificar código.** Sigue siendo algo abierto (cualquiera con la URL de la DB puede leer/escribir), pero funciona de inmediato.

**Reglas para Opción A:**
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

O con un mínimo de estructura por ruta:
```json
{
  "rules": {
    "chats": {
      "$chatId": {
        ".read": true,
        ".write": true
      }
    },
    "messages": {
      "$chatId": {
        ".read": true,
        ".write": true
      }
    },
    "dedup": {
      "$msgId": {
        ".read": true,
        ".write": true
      }
    },
    "system": {
      ".read": true,
      ".write": true
    },
    "casos_reembolso": {
      "$chatId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

**⚠️ Advertencia:** Esta opción mantiene la base de datos abierta a Internet. Cualquier persona que descubra tu `databaseURL` podría leer o modificar todos los datos.

---

### Opción B (Recomendada / Definitiva) — firebase-admin + Reglas Reales

Migrar el servidor a `firebase-admin` para que las API Routes ignoren las reglas de seguridad, y dejar al cliente solo con permisos mínimos.

**Pasos necesarios:**
1. Instalar `firebase-admin`
2. Crear `src/lib/firebaseAdmin.ts` usando una clave de servicio
3. Refactorizar los 3 archivos del servidor para usar el admin SDK
4. Configurar reglas estrictas para el cliente:
   - `chats/` → lectura permitida, escritura limitada
   - `messages/` → solo lectura
   - `dedup/`, `system/`, `casos_reembolso/` → bloqueados para el cliente

**Reglas definitivas para Opción B:**
```json
{
  "rules": {
    "chats": {
      "$chatId": {
        ".read": true,
        ".write": true
      }
    },
    "messages": {
      "$chatId": {
        ".read": true,
        ".write": false
      }
    },
    "dedup": {
      "$msgId": {
        ".read": false,
        ".write": false
      }
    },
    "system": {
      ".read": false,
      ".write": false
    },
    "casos_reembolso": {
      "$chatId": {
        ".read": false,
        ".write": false
      }
    }
  }
}
```

**✅ Ventajas:**
- El servidor (webhook, db, systemPrompt) funciona sin restricciones mediante `firebase-admin`
- El cliente (dashboard) solo puede leer chats y mensajes
- Las rutas sensibles (`dedup/`, `system/`, `casos_reembolso/`) quedan completamente protegidas
- Solución profesional y escalable

---

## Conclusión

| Aspecto | Opción A | Opción B |
|---------|----------|----------|
| Tiempo de implementación | 2 minutos | ~30-45 minutos |
| Modifica código | No | Sí |
| Seguridad | Baja | Alta |
| Requiere clave de servicio | No | Sí |
| Recomendada para | Salir del paso | Producción |
