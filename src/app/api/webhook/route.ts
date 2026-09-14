import { NextRequest, NextResponse } from 'next/server';
import { Message } from '@/types';
import { getFirebaseDB } from '@/lib/firebase';
import { ref, set, get, child, update, runTransaction } from 'firebase/database';
import {
  buildMenuText,
  detectFlow,
  detectOption1200,
  hasVerificationData,
  getFlowPrompt,
  SONIA_IDENTITY,
  FlowId,
} from '@/lib/menu';

import { extractMontoBs, clasificarMonto, generarCasoId, formatearFechaAhora } from '@/lib/monto';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

// --- AI providers: agnes (primary, OpenAI-compatible) + Gemini (fallback) ---
const AGNES_API_KEY = process.env.AGNES_API_KEY;
const AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1';
const AGNES_MODEL = 'agnes-2.5-flash';

function normalizeChatId(rawPhone: string): string {
  return rawPhone.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '');
}

function toWhatsAppId(phone: string): string {
  if (phone.includes('@')) return phone;
  return phone.replace(/\D/g, '') + '@s.whatsapp.net';
}

function sanitizeKey(key: string): string {
  return key.replace(/[.#$\[\]]/g, '_');
}

/** Guarda un mensaje saliente del agente y lo persiste en el historial. */
async function saveAgentMessage(db: any, chatId: string, content: string) {
  const aiId = 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  await set(ref(db, 'messages/' + chatId + '/' + aiId), {
    id: aiId,
    chatId,
    content,
    sender: 'agent',
    timestamp: Date.now(),
    status: 'sent',
  });
  await update(ref(db, 'chats/' + chatId), {
    lastMessage: content,
    lastMessageTime: Date.now(),
  });
}

/** EnvÃ­a texto por WhatsApp vÃ­a WHAPI y devuelve si fue OK. */
async function sendWhapi(chatId: string, text: string): Promise<boolean> {
  const res = await fetch(WHAPI_BASE_URL + '/messages/text', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: toWhatsAppId(chatId), body: text }),
  });
  return res.ok;
}

/** Construye el mensaje de corrección de cuenta según los dígitos detectados. */
function buildCuentaCorrectionCopy(cuenta: string, nombre?: string): string {
  const n = cuenta.replace(/\D/g, '').length;
  const primerNombre = (nombre || '').trim().split(/\s+/)[0];
  if (n === 0) {
    return 'Oye, no logré identificar bien el número de cuenta que me enviaste 🙈 ¿Puedes escribirlo de nuevo? Recuerda que debe tener exactamente 20 dígitos. 💚';
  }
  if (n < 20) {
    const faltan = 20 - n;
    return `Oye ${primerNombre}, el número de cuenta que me diste tiene ${n} dígitos y le faltan ${faltan} para llegar a 20. ¿Puedes verificar el número completo y pasármelo de nuevo? 💚`;
  }
  const sobran = n - 20;
  return `Oye ${primerNombre}, el número de cuenta que me diste tiene ${n} dígitos, o sea ${sobran} de más (debe tener exactamente 20). ¿Puedes verificar el número y pasármelo de nuevo? 💚`;
}

/**
 * Genera texto de IA. PRIMERO AGNES (OpenAI-compatible); si no estÃ¡
 * configurada o falla, cae a Gemini. Devuelve '' si ambos fallan.
 */
async function callAI(prompt: string, temperature: number, extractMode = false): Promise<string> {
  // 1) Agnes (primary)
  if (AGNES_API_KEY) {
    try {
      const res = await fetch(AGNES_BASE_URL + '/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + AGNES_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: AGNES_MODEL,
          temperature,
          messages: [
            { role: 'system', content: extractMode ? 'Devuelve UNICAMENTE un JSON valido sin Markdown. Si no encuentras algun dato, deja el valor en blanco ("").' : 'Eres Sonia de VOLTAJE PLUS. Da respuestas naturales y breves en primera persona. No digas que eres IA.' },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (typeof text === 'string' && text.trim()) return text.trim();
      }
      console.error('[AI] agnes failed:', res.status);
    } catch (e) {
      console.error('[AI] agnes error:', e);
    }
  }

  // 2) Gemini (fallback)
  if (GOOGLE_API_KEY) {
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GOOGLE_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature } })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === 'string' && text.trim()) return text.trim();
      }
      console.error('[AI] gemini failed:', res.status);
    } catch (e) {
      console.error('[AI] gemini error:', e);
    }
  }

  return '';
}

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  console.log('[WEBHOOK] === REQUEST START ===');

  try {
    const body = await req.json();
    const msgs = body.messages || [];
    console.log('[WEBHOOK] Messages count:', msgs.length);

    if (!msgs.length) {
      return NextResponse.json({ error: 'No messages' }, { status: 400 });
    }

    const msg = msgs[0];
    if (msg.from_me) {
      console.log('[WEBHOOK] Skipping own message');
      return NextResponse.json({ success: true });
    }

    const rawPhone = msg.chat_id || msg.from || '';
    const chatId = normalizeChatId(rawPhone);
    if (!chatId) {
      return NextResponse.json({ error: 'No phone number' }, { status: 400 });
    }

    const db = getFirebaseDB();

    // === 1. Save ALL messages with atomic dedup ===
    let savedCount = 0;
    for (const m of msgs) {
      if (m.from_me) continue;

      const mRawPhone = m.chat_id || m.from || rawPhone;
      const mChatId = normalizeChatId(mRawPhone);
      if (mChatId !== chatId) continue;

      const mId = m.id ? sanitizeKey(m.id) : 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

      const dedupRef = ref(db, 'dedup/' + mId);
      const dedupResult = await runTransaction(dedupRef, (current: number | null) => {
        if (current) return;
        return Date.now();
      });
      if (!dedupResult.committed) {
        console.log('[WEBHOOK] Duplicate (atomic skip):', m.id);
        continue;
      }

      const mContent = m.text?.body || '';
      const pushName = m.from_name || m.sender?.pushname || m.sender?.name || m.pushname || m.notify;
      const mType = m.type || 'text';
      const isImage = mType === 'image' || mType === 'sticker' || !!m.image || mContent === '[Imagen]';

      const msgData: Message = {
        id: mId, chatId: mChatId, content: mContent || '[Imagen]',
        sender: 'user', timestamp: Date.now(), status: 'delivered'
      };
      await set(ref(db, 'messages/' + mChatId + '/' + mId), msgData);

      if (pushName) {
        const chatSnap = await get(child(ref(db), 'chats/' + mChatId));
        if (!chatSnap.val()?.name) {
          await update(ref(db, 'chats/' + mChatId), { name: pushName });
        }
      }

      savedCount++;
    }

    if (savedCount === 0) {
      console.log('[WEBHOOK] All messages were duplicates');
      return NextResponse.json({ success: true });
    }

    // === 2. Update chat metadata (preserve aiEnabled) ===
    const chatRef = ref(db, 'chats/' + chatId);
    const chatSnap = await get(chatRef);
    const oldChat = chatSnap.val() || {};

    await update(chatRef, {
      phone: chatId,
      lastMessage: msg.text?.body || '[Imagen]',
      lastMessageTime: Date.now(),
      unreadCount: (oldChat.unreadCount || 0) + savedCount,
    });
    console.log('[WEBHOOK] Messages saved:', savedCount);

    // === 3. RESPECT AI TOGGLE ===
    if (oldChat.aiEnabled === false) {
      console.log('[WEBHOOK] AI is DISABLED for this chat â€” no response sent');
      return NextResponse.json({ success: true });
    }

    // === 4. IMAGE THROTTLING LOGIC ===
    let shouldCallAI = true;
    let customMsgForAI = msg.text?.body || '';
    let didTrigger = false;

    const isImageMessage = (m: any) => {
      const mType = m.type || 'text';
      const mContent = m.text?.body || '';
      return mType === 'image' || mType === 'sticker' || !!m.image || mContent === '[Imagen]' || mContent.includes('Imagen received') || mContent.includes('album') || (mType !== 'text' && !mContent && !m.text);
    };

    if (msgs.some(isImageMessage)) {
      const chatRef = ref(db, 'chats/' + chatId);
      let newCount = 0;

      try {
        const txResult = await runTransaction(child(chatRef, 'imageCount'), (currentCount: number | null) => {
          const count = (currentCount || 0) + msgs.filter(isImageMessage).length;
          if (count >= 3) return 0;
          return count;
        });

        if (txResult.committed) {
          newCount = txResult.snapshot.val();
          if (newCount === 0) didTrigger = true;
        }
      } catch (e) {
        console.error('[IMG] Transaction failed:', e);
      }

      console.log('[IMG] Current count:', newCount, '/ 3');

      if (didTrigger) {
        console.log('[IMG] Got 3+ images! Triggering AI to request data...');
        customMsgForAI = '[Sistema: El usuario ha enviado 3 imagenes. Ahora debe pedir los datos personales y bancarios.]';
      } else {
        console.log('[IMG] Waiting for more images, staying silent.');
        shouldCallAI = false;
      }
    }

    if (!shouldCallAI) {
      return NextResponse.json({ success: true });
    }

    // === 5. DEBOUNCE LOCK — agrupar mensajes rÃ¡pidos ===
    // El usuario suele escribir en partes ("hola", "como", "estas" o
    // "pague 1200", "porfa reembolso"). Este lock espera a que el usuario
    // deje de escribir y responde UNA sola vez con todo el contexto junto.
    try {
      const lockRef = ref(db, 'locks/' + chatId);
      const lockResult = await runTransaction(lockRef, (currentLock: any) => {
        if (currentLock && (Date.now() - currentLock.ts) < 10000) return;
        return { ts: Date.now() };
      });

      if (!lockResult.committed) {
        if (didTrigger) {
          await update(ref(db, 'chats/' + chatId), { pendingImageTrigger: true });
        }
        console.log('[LOCK] Debounce active, message queued');
        return NextResponse.json({ success: true });
      }

      console.log('[LOCK] Lock acquired, debouncing to group rapid messages');
      const WINDOW = 3000;     // espera de silencio para agrupar
      const MAX_TOTAL = 7000;  // tope máximo de espera entre todos los mensajes
      const TICK = 600;        // intervalo de revisión
      const start = Date.now();
      let msgCount = Object.keys((await get(ref(db, 'messages/' + chatId))).val() || {}).length;

      // Mantiene el lock mientras lleguen mensajes nuevos: cada vez que el
      // usuario escribe se reinicia la espera de silencio (max MAX_MS total).
      while (Date.now() - start < MAX_TOTAL) {
        await new Promise(resolve => setTimeout(resolve, TICK));

        let nowCount = msgCount;
        try {
          nowCount = Object.keys((await get(ref(db, 'messages/' + chatId))).val() || {}).length;
        } catch (e) { /* ignore */ }

        if (nowCount > msgCount) {
          msgCount = nowCount;
          console.log('[LOCK] New message during window â€” resetting silent timer');
        } else if ((Date.now() - start) >= WINDOW) {
          console.log('[LOCK] Silent window reached, processing batch');
          break;
        }
      }

      await set(lockRef, null);

      const chatPostLock = await get(ref(db, 'chats/' + chatId));
      const chatPostData = chatPostLock.val() || {};
      if (chatPostData.pendingImageTrigger) {
        console.log('[LOCK] Image trigger during debounce, injecting');
        customMsgForAI = '[Sistema: El usuario ha enviado 3 imagenes. Ahora debe pedir los datos personales y bancarios.]';
        await update(ref(db, 'chats/' + chatId), { pendingImageTrigger: null });
      }
    } catch (e) {
      console.log('[LOCK] Error (likely Firebase rules), falling through to direct AI call:', e);
    }

    // === 5B. Obtener mensajes del chat para validación ===
    // Necesitamos los mensajes para la lógica de 1200bs error
    const histSnap = await get(ref(db, 'messages/' + chatId));
    const allMsgs = Object.values(histSnap.val() || {}).sort((a: any, b: any) => a.timestamp - b.timestamp) as Message[];

    // === 5B. MENÃš / ESTADO DE CONVERSACIÃ“N ===
    // El estado del flujo se persiste DENTRO de chats/{chatId}/estado (path
    // que el webhook ya usa y las reglas ya permiten), evitando depender de un
    // path nuevo que podrÃ­a estar bloqueado por las reglas de Firebase.
    const chatEstRef = ref(db, 'chats/' + chatId);
    let estado: any = {};
    try {
      const chatSnap2 = await get(chatEstRef);
      estado = chatSnap2.val()?.estado || {};
    } catch (e) {
      console.log('[MENU] Error reading chat.estado (defaults to menu):', e);
    }

    const userText = (customMsgForAI || '').trim();

    // ===== PRIMERO: Procesar captura de datos multi-paso ANTES de los manejadores =====
    // Leer estado actualizado desde BD (incluyendo capturas previas en este request)
    let estadoActual: any = estado;
    try {
      const estSnap = await get(chatEstRef);
      estadoActual = estSnap.val()?.estado || estado;
    } catch (e) {
      console.log('[MENU] Error re-leyendo estado:', e);
    }
    
    const waitingForCapture = estadoActual.waitingFor;
    const currentFlow = estadoActual.flow || 'menu';
    
    // Procesar captura de datos si hay waitingFor pendiente
    if (waitingForCapture) {
      const userLower = userText.toLowerCase();
      let updates: any = { estado: { ...estadoActual } };
      
      // publicidad_dooh - capturar marca y plan
      if (currentFlow === 'publicidad_dooh' && waitingForCapture === 'marca_plan') {
        let marca = '';
        let plan = '';
        const text = userText.trim();
        const lower = text.toLowerCase();
        
        const planes = ['estandar', 'estándar', 'premium', 'dominancia', 'exclusiva'];
        for (const p of planes) {
          if (lower.includes(p)) { plan = p.charAt(0).toUpperCase() + p.slice(1); break; }
        }
        
        const marcaPatterns = [
          /(?:marca|empresa|negocio|brand)\s*(?:es|:|se llama)\s*([^,.\n]+)/i,
          /^(?:para|quiero).*?(?:mi\s+)?(?:marca|empresa|negocio)\s+([^,.\n]+)/i,
          /^([^,.\n]+?)(?:\s*,\s*(?:plan|quiero|estandar|premium|dominancia))/i,
        ];
        
        for (const pattern of marcaPatterns) {
          const match = text.match(pattern);
          if (match && match[1]) { marca = match[1].trim(); break; }
        }
        
        const lineas = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
        if (!marca) marca = lineas[0] || text.slice(0, 100);
        if (!plan) plan = 'sin definir';
        
        updates.estado.marca = marca.slice(0, 100);
        updates.estado.plan = plan;
        await update(chatEstRef, updates);
        estadoActual = updates.estado; // Actualizar estado local
      }
      
      // estacion_gratis - capturar negocio y zona
      if (currentFlow === 'estacion_gratis' && waitingForCapture === 'negocio_zona') {
        let negocio = '';
        let zona = '';
        const text = userText.trim();
        
        const negocioPatterns = [
          /(?:negocio|negocio se llama|negocio es|se llama|me llamo|mi negocio)\s*(?:es|:)\s*([^,.\n]+)/i,
          /^([^,.\n]+?)(?:\s*,\s*(?:se ubica|ubicad[ao]|est[áa]|en|zona|direcci[oó]n))/i,
        ];
        
        for (const pattern of negocioPatterns) {
          const match = text.match(pattern);
          if (match && match[1]) { negocio = match[1].trim(); break; }
        }
        
        const zonaPatterns = [
          /(?:se ubica|ubicad[ao]|est[áa]|en|zona|direcci[oó]n)\s*(?:es|:|en)\s*([^,.\n]+)/i,
          /(?:en|zona|direcci[oó]n)\s+([^,.\n]+)$/i,
        ];
        
        for (const pattern of zonaPatterns) {
          const match = text.match(pattern);
          if (match && match[1]) { zona = match[1].trim(); break; }
        }
        
        const lineas = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
        if (!negocio && lineas[0]) negocio = lineas[0];
        if (!zona && lineas.length > 1) zona = lineas.slice(1).join(' ');
        
        updates.estado.negocio = negocio.slice(0, 100) || text.slice(0, 100);
        updates.estado.zona = zona || 'no especificada';
        await update(chatEstRef, updates);
        estadoActual = updates.estado;
      }
      
      // estacion_evento - capturar datos
      if (currentFlow === 'estacion_evento' && waitingForCapture === 'datos_evento') {
        const text = userText.trim();
        const lower = text.toLowerCase();
        
        if (!updates.estado.fecha) {
          const fechaMatch = text.match(/\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?/);
          if (fechaMatch) updates.estado.fecha = fechaMatch[0];
        }
        
        if (!updates.estado.asistentes) {
          const asistentesMatch = lower.match(/(\d{1,4})\s*(?:personas?|invitados?|asistentes?|gente)/);
          if (asistentesMatch) updates.estado.asistentes = asistentesMatch[1];
          const paraMatch = lower.match(/para\s+(\d{1,4})\s*(?:personas?|invitados?)/);
          if (paraMatch) updates.estado.asistentes = paraMatch[1];
        }
        
        if (!updates.estado.ubicacion) {
          const ubicacionPatterns = [
            /(?:en|ubicad[ao]|ubicaci[oó]n|lugar|sitio|direcci[oó]n|zona)\s*(?:es|:)?\s*(?:en\s*)?([^,.\n]+)/i,
            /(?:en|en el|en la|ubicado en|ubicada en)\s+([^,.\n]+)/i,
          ];
          for (const pattern of ubicacionPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) { updates.estado.ubicacion = match[1].trim(); break; }
          }
        }
        
        if (!updates.estado.tipoEvento) {
          const tipoKeywords = ['boda', 'fiesta', 'conferencia', 'congreso', 'feria', 'cumpleaños', 'quince', '15 años', 'graduación', 'empresarial', 'corporativo', 'show', 'concierto', 'festival'];
          for (const kw of tipoKeywords) {
            if (lower.includes(kw)) { updates.estado.tipoEvento = kw; break; }
          }
          if (!updates.estado.tipoEvento) {
            const lineas = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
            updates.estado.tipoEvento = lineas[0]?.slice(0, 50) || text.slice(0, 50);
          }
        }
        
        await update(chatEstRef, updates);
        estadoActual = updates.estado;
      }
      
      // agente_humano - capturar nombre y motivo
      if (currentFlow === 'agente_humano' && waitingForCapture === 'nombre_motivo') {
        const text = userText.trim();
        const lower = text.toLowerCase();
        
        let nombre = '';
        let motivo = '';
        
        const nombrePatterns = [
          /(?:me llamo|soy|mi nombre es|nombre)\s*(?:es|:)\s*([^,.\n]+)/i,
          /^([^,.\n]+?)(?:\s*(?:y|,)\s*(?:quiero|necesito|motivo|trabajo))/i,
        ];
        
        for (const pattern of nombrePatterns) {
          const match = text.match(pattern);
          if (match && match[1]) { nombre = match[1].trim(); break; }
        }
        
        const motivoPatterns = [
          /(?:motivo|porque|por qué|raz[oó]n)\s*(?:es|:)\s*([^,.\n]+)/i,
          /(?:quiero|necesito|busco)\s+(?:hablar|ayuda|ayuda con|resolver)\s+([^,.\n]+)/i,
          /(?:y|,)\s*(?:quiero|necesito|motivo|busco)\s+([^,.\n]+)/i,
        ];
        
        for (const pattern of motivoPatterns) {
          const match = text.match(pattern);
          if (match && match[1]) { motivo = match[1].trim(); break; }
        }
        
        const lineas = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
        if (!nombre) nombre = lineas[0] || text.slice(0, 50);
        if (!motivo) motivo = lineas.slice(1).join(' ') || text.slice(nombre.length).slice(0, 100) || 'no especificado';
        
        updates.estado.nombre = nombre.slice(0, 50);
        updates.estado.motivo = motivo.slice(0, 200);
        await update(chatEstRef, updates);
        estadoActual = updates.estado;
      }
    }

    // PRIMER CONTACTO: aún no hay estado registrado → SIEMPRE mostrar el menú
    if (!estadoActual.flow) {
      console.log('[MENU] First contact — sending menu.');
      const menuText = buildMenuText();
      await sendWhapi(chatId, menuText);
      await saveAgentMessage(db, chatId, menuText);
      try { await update(chatEstRef, { estado: { flow: 'menu', firstSent: Date.now() } }); } catch (e) { console.log('[MENU] persist menu failed:', e); }
      console.log('[MENU] Menu sent.');
      return NextResponse.json({ success: true });
    }

    // Detectar a qué flujo debe moverse según el mensaje del usuario.
    const detected = detectFlow(userText);
    let activeFlow: FlowId = (estadoActual.flow as FlowId) || 'menu';

    if (detected && detected !== estadoActual.flow) {
      activeFlow = detected;
      console.log('[MENU] Flow changed to:', activeFlow);
    } else if (detected === 'menu') {
      activeFlow = 'menu';
    }

    // === LÓGICA ESPECIAL PARA FLUJO DE 1200BS (cupón CHARGE_GO) ===
    // Este flujo requiere interacción paso a paso, no solo el prompt de IA
    if (activeFlow === 'reembolso_1200_error') {
      // Usar estadoActual ya actualizado con captura de datos
      const chatEstado = estadoActual;

      // Paso 1: ¿El usuario ya confirmó que fue error?
      if (!chatEstado.error1200Confirmed) {
        // Primera vez en este flujo: preguntar confirmación
        const confirmationText = 'Ok, los 1200bs que transferiste para hacer uso del servicio del alquiler power bank fueron por error, ¿cierto?';
        console.log('[1200_ERROR] Asking confirmation');
        await sendWhapi(chatId, confirmationText);
        await saveAgentMessage(db, chatId, confirmationText);
        
        // Guardar que estamos esperando confirmación
        try {
          await update(chatEstRef, { 
            estado: { 
              flow: 'reembolso_1200_error',
              error1200Confirmed: null,  // null = esperando confirmación
              waitingFor: 'error_confirmation'
            } 
          });
        } catch (e) {
          console.log('[1200_ERROR] persist state failed:', e);
        }
        
        return NextResponse.json({ success: true });
      }

      // Paso 2: ¿El usuario ya eligió opción (reembolso o cupón)?
      if (!chatEstado.optionChosen) {
        // El usuario confirmó que fue error, ahora ofrecer opciones
        // ⚠️ REGLAS DE SEGURIDAD: NO mencionar el nombre del cupón (CHARGE_GO) antes de validar datos
        const optionText = 'Tenemos 2 opciones disponibles:\n' +
          'a) Te reembolsamos los 1200bs que transferiste por error.\n' +
          'b) Para que puedas hacer uso del power bank ya que lo necesitas y transferiste 1200bs, tenemos un cupón disponible, el cual te permitirá escanear, expulsar el power bank y hacer uso durante 30 minutos.\n' +
          '¿Qué prefieres?';
        console.log('[1200_ERROR] Offering options');
        await sendWhapi(chatId, optionText);
        await saveAgentMessage(db, chatId, optionText);
        
        try {
          await update(chatEstRef, { 
            estado: { 
              flow: 'reembolso_1200_error',
              error1200Confirmed: true,
              waitingFor: 'option_choice'
            } 
          });
        } catch (e) {
          console.log('[1200_ERROR] persist state failed:', e);
        }
        
        return NextResponse.json({ success: true });
      }

      // Paso 3: ¿El usuario eligió cupón y ya envió datos de verificación?
      if (chatEstado.optionChosen === 'cupon' && !chatEstado.verificationSent) {
        // El usuario eligió cupón, pedir verificación
        // ⚠️ REGLAS DE SEGURIDAD: NO mencionar el nombre del cupón (CHARGE_GO) antes de validar datos
        const verificationText = 'Para activar tu cupón, necesito verificar: por favor envíame nuevamente el número de referencia de la operación, el monto exacto y una captura de la transferencia.';
        console.log('[1200_ERROR] Requesting verification for cupon');
        await sendWhapi(chatId, verificationText);
        await saveAgentMessage(db, chatId, verificationText);
        
        try {
          await update(chatEstRef, { 
            estado: { 
              flow: 'reembolso_1200_error',
              error1200Confirmed: true,
              optionChosen: 'cupon',
              waitingFor: 'verification_data'
            } 
          });
        } catch (e) {
          console.log('[1200_ERROR] persist state failed:', e);
        }
        
        return NextResponse.json({ success: true });
      }

      // Paso 4: ¿El usuario eligió cupón, envió datos de verificación y ya validamos?
      if (chatEstado.optionChosen === 'cupon' && chatEstado.verificationSent && !chatEstado.cuponSent) {
        // Validar que el usuario envió referencia, monto y captura
        const lastUserMsgs = allMsgs.filter(m => m.sender === 'user').slice(-3);
        const lastMsg = lastUserMsgs[lastUserMsgs.length - 1];
        
        if (lastMsg && lastMsg.content) {
          const verification = hasVerificationData(lastMsg.content);
          
          // Verificar si tenemos datos previos guardados
          const prevData = chatEstado.prevUserData || {};
          const hasPrevReference = prevData.referencia && prevData.referencia.length > 0;
          const prevMonto = prevData.monto || '';
          
          // Extraer datos del mensaje actual
          const msgText = lastMsg.content.toLowerCase();
          const msgHasReference = verification.hasReference || /[a-zA-Z0-9]{8,20}/.test(msgText);
          const msgHasMonto = verification.hasMonto || /(1200|1\.200|mil doscientos)/i.test(msgText);
          const msgHasCaptura = verification.hasCaptura || lastMsg.content.includes('[Imagen]');
          
          console.log('[1200_ERROR] Verification check - ref:', msgHasReference, 'monto:', msgHasMonto, 'captura:', msgHasCaptura);
          
          // Si tenemos referencia, monto y captura (o imagen)
          if ((msgHasReference || hasPrevReference) && msgHasMonto && (msgHasCaptura || lastMsg.content.includes('[Imagen]'))) {
            // Enviar código del cupón
            const cuponCodeText = '¡Listo! Tu cupón CHARGE_GO está activo. Para usarlo en la app de Voltaje Plus: 1) Ingresa a la app, 2) Ve al ícono de menú en la esquina superior izquierda, 3) Selecciona \'Cupones\', 4) Haz click en \'Agregar código promocional\', 5) Ingresa CHARGE_GO. ¡Listo para usar! 💚';
            console.log('[1200_ERROR] Sending cupon code');
            await sendWhapi(chatId, cuponCodeText);
            await saveAgentMessage(db, chatId, cuponCodeText);
            
            try {
              await update(chatEstRef, { 
                estado: { 
                  flow: 'reembolso_1200_error',
                  error1200Confirmed: true,
                  optionChosen: 'cupon',
                  verificationSent: true,
                  cuponSent: true,
                  waitingFor: null
                } 
              });
            } catch (e) {
              console.log('[1200_ERROR] persist state failed:', e);
            }
            
            return NextResponse.json({ success: true });
          } else {
            // Datos incompletos, pedir lo que falta
            let missingText = 'Por favor, necesito que me envíes:';
            const missing: string[] = [];
            if (!msgHasReference && !hasPrevReference) missing.push('número de referencia');
            if (!msgHasMonto) missing.push('monto exacto (1200 Bs)');
            if (!msgHasCaptura && !lastMsg.content.includes('[Imagen]')) missing.push('captura de la transferencia');
            missingText += '\n- ' + missing.join('\n- ');
            
            console.log('[1200_ERROR] Missing verification data');
            await sendWhapi(chatId, missingText);
            await saveAgentMessage(db, chatId, missingText);
            return NextResponse.json({ success: true });
          }
        }
      }
    }

    // === LÓGICA ESPECIAL PARA MANEJO DE CONFIRMACIÓN DE ERROR 1200BS ===
    // Si estamos en flujo reembolso_1200_error y el usuario responde, actualizar estado
    if (estado.flow === 'reembolso_1200_error' && !estado.error1200Confirmed) {
      // El usuario respondió a la pregunta de confirmación
      const userConfirmation = userText.toLowerCase();
      const isConfirmed = /(sí|si|sip|claro|correcto|cierto|ajá|ah sí|sí, fue error|sí, por error)/.test(userConfirmation);
      const isDenied = /(no|no fue|no es|no lo fue|no es así)/.test(userConfirmation);
      
      if (isConfirmed) {
        // Marcar como confirmado y cambiar a espera de opción
        console.log('[1200_ERROR] User confirmed error');
        try {
          await update(chatEstRef, { 
            estado: { 
              flow: 'reembolso_1200_error',
              error1200Confirmed: true,
              waitingFor: 'option_choice'
            } 
          });
        } catch (e) {
          console.log('[1200_ERROR] persist state failed:', e);
        }
        
        // No enviar respuesta aún, el siguiente mensaje manejará las opciones
        // Pero si no hay más lógica, enviar las opciones ahora
        // ⚠️ REGLAS DE SEGURIDAD: NO mencionar el nombre del cupón (CHARGE_GO) antes de validar datos
        const optionText = 'Tenemos 2 opciones disponibles:\n' +
          'a) Te reembolsamos los 1200bs que transferiste por error.\n' +
          'b) Para que puedas hacer uso del power bank ya que lo necesitas y transferiste 1200bs, tenemos un cupón disponible, el cual te permitirá escanear, expulsar el power bank y hacer uso durante 30 minutos.\n' +
          '¿Qué prefieres?';
        await sendWhapi(chatId, optionText);
        await saveAgentMessage(db, chatId, optionText);
        return NextResponse.json({ success: true });
      } else if (isDenied) {
        // No fue error, volver a menú
        console.log('[1200_ERROR] User denied error');
        const menuText = buildMenuText();
        await sendWhapi(chatId, menuText);
        await saveAgentMessage(db, chatId, menuText);
        try {
          await update(chatEstRef, { 
            estado: { 
              flow: 'menu',
              error1200Confirmed: false,
              optionChosen: null,
              waitingFor: null
            } 
          });
        } catch (e) {
          console.log('[1200_ERROR] persist state failed:', e);
        }
        return NextResponse.json({ success: true });
      }
    }

    // === LÓGICA ESPECIAL PARA DETECCIÓN DE OPCIÓN (reembolso o cupón) ===
    if (estado.flow === 'reembolso_1200_error' && estado.error1200Confirmed && !estado.optionChosen) {
      // El usuario elige entre reembolso o cupón
      const userChoice = detectOption1200(userText);
      
      if (userChoice) {
        console.log('[1200_ERROR] User chose option:', userChoice);
        
        if (userChoice === 'reembolso') {
          // El usuario eligió reembolso, activar flujo normal de reembolso
          try {
            await update(chatEstRef, { 
              estado: { 
                flow: 'reembolso',
                error1200Confirmed: true,
                optionChosen: 'reembolso',
                waitingFor: null
              } 
            });
          } catch (e) {
            console.log('[1200_ERROR] persist state failed:', e);
          }
          
          // Dejar que el flujo normal de reembolso continúe
          activeFlow = 'reembolso';
          
        } else if (userChoice === 'cupon') {
          // El usuario eligió cupón, ahora pedir datos
          try {
            await update(chatEstRef, { 
              estado: { 
                flow: 'reembolso_1200_error',
                error1200Confirmed: true,
                optionChosen: 'cupon',
                waitingFor: 'user_data'
              } 
            });
          } catch (e) {
            console.log('[1200_ERROR] persist state failed:', e);
          }
          
          // Pedir datos del usuario para el cupón
          // ⚠️ REGLAS DE SEGURIDAD: NO mencionar el nombre del cupón (CHARGE_GO) antes de validar datos
          const dataText = 'Para procesar tu cupón, necesito tus datos:\n' +
            '- Nombre completo\n' +
            '- Cédula de identidad\n' +
            '- Teléfono\n' +
            '- Cuenta bancaria (20 dígitos)\n' +
            '- Banco\n' +
            '- Ubicación de la estación\n' +
            '- Fecha y hora de la transferencia\n' +
            '- Número de referencia bancaria\n' +
            '¡Quedo atenta! 💚';
          await sendWhapi(chatId, dataText);
          await saveAgentMessage(db, chatId, dataText);
          return NextResponse.json({ success: true });
        }
        
        // Persistir el flujo
        try {
          await update(chatEstRef, { estado: { flow: activeFlow } });
        } catch (e) {
          console.log('[MENU] persist flow failed:', e);
        }
      }
    }

    // === LÓGICA ESPECIAL: Si usuario eligió cupón y está enviando datos ===
    if (estado.flow === 'reembolso_1200_error' && estado.optionChosen === 'cupon' && 
        estado.waitingFor === 'user_data' && !estado.verificationRequested) {
      // El usuario está enviando sus datos para el cupón
      // Verificar si el mensaje contiene datos de usuario
      const hasUserData = /(nombre|cedula|tel[ée]fono|c[úu]enta|banco|ubicaci[óo]n|fecha|hora|referencia)/i.test(userText);
      
      if (hasUserData) {
        // Guardar datos temporalmente y pedir verificación
        console.log('[1200_ERROR] User data received, requesting verification');
        
        // Extraer datos básicos del mensaje
        const msgText = userText;
        const extractedData: any = {};
        
        // Intentar extraer datos simples
        const montoMatch = msgText.match(/(\d{1,4}[.,]?\d{0,3})[\s]*(?:bs|bolivares|bss)/i);
        if (montoMatch) {
          extractedData.monto = montoMatch[1].replace('.', '');
        }
        
        // Guardar datos extraídos temporalmente
        try {
          await update(chatEstRef, { 
            estado: { 
              flow: 'reembolso_1200_error',
              error1200Confirmed: true,
              optionChosen: 'cupon',
              waitingFor: 'verification_data',
              prevUserData: extractedData,
              verificationRequested: true
            } 
          });
        } catch (e) {
          console.log('[1200_ERROR] persist state failed:', e);
        }
        
        // Pedir verificación
        const verificationText = 'Para activar tu cupón CHARGE_GO, necesito verificar: por favor envíame nuevamente el número de referencia de la operación, el monto exacto y una captura de la transferencia.';
        await sendWhapi(chatId, verificationText);
        await saveAgentMessage(db, chatId, verificationText);
        return NextResponse.json({ success: true });
      }
    }

    // ===== NUEVOS FLUJOS SEGÚN PROMPT ACTUALIZADO =====

    // --- FLUJO: falla_alquiler (primer paso - preguntar monto) ---
    if (activeFlow === 'falla_alquiler') {
      console.log('[FALLA_ALQUILER] Preguntando monto exacto');
      const preguntaMonto = '¡Uy, lamento mucho eso! 😣 Para ayudarte rápido, ¿de cuánto fue el monto exacto que pagaste?';
      await sendWhapi(chatId, preguntaMonto);
      await saveAgentMessage(db, chatId, preguntaMonto);
      
      try {
        await update(chatEstRef, { estado: { flow: 'falla_alquiler_monto', waitingFor: 'monto_exacto' } });
      } catch (e) {
        console.log('[FALLA_ALQUILER] persist state failed:', e);
      }
      return NextResponse.json({ success: true });
    }

    // --- FLUJO: falla_alquiler_monto (clasificar por monto) ---
    if (activeFlow === 'falla_alquiler_monto' && estado.waitingFor === 'monto_exacto') {
      const monto = extractMontoBs(userText);
      console.log('[FALLA_ALQUILER_MONTO] Monto detectado:', monto);
      
      if (monto === null) {
        const reintento = 'No logré identificar el monto 🙈 ¿Me dices exactamente cuánto pagaste? (ej: 1200, 12000, 6000, etc.)';
        await sendWhapi(chatId, reintento);
        await saveAgentMessage(db, chatId, reintento);
        return NextResponse.json({ success: true });
      }
      
      const clasificacion = clasificarMonto(monto);
      console.log('[FALLA_ALQUILER_MONTO] Clasificación:', clasificacion);
      
      if (clasificacion === 'falla_12000') {
        // Flujo 1.A: Escalar a soporte técnico (12000 Bs)
        const casoId = generarCasoId();
        const ubicacion = oldChat.name ? `Ubicación: ${oldChat.name}` : 'Ubicación: no especificada';
        const observaciones = `Revocado/no dispensó batería — escalado a soporte técnico. ${ubicacion}.`;
        
        // Guardar caso en "Casos de Atención"
        try {
          await set(ref(db, 'casos_atencion/' + chatId), {
            id: chatId,
            caso_id: casoId,
            tipo: 'FALLA_ALQUILER',
            fecha: formatearFechaAhora(),
            usuario: oldChat.name || 'Sin nombre',
            telefono: chatId,
            monto: '12000',
            observaciones,
            estado: 'Pendiente',
          });
        } catch (e) {
          console.error('[CASO_ATENCION] Error guardando FALLA_ALQUILER:', e);
        }
        
        const respuesta = `Esto necesita corrección inmediata de nuestro equipo técnico para detener el cobro. Por favor, **llama o escribe ahora mismo al 0412-685-1090** (https://wa.me/584126851090) y te lo resuelven al instante. **Tu caso (ID: ${casoId}) ya está registrado**. ¡Gracias por avisarme! 💚`;
        
        await sendWhapi(chatId, respuesta);
        await saveAgentMessage(db, chatId, respuesta);
        
        try {
          await update(chatEstRef, { estado: { flow: 'menu' } });
        } catch (e) {}
        
        return NextResponse.json({ success: true });
      }
      
      if (clasificacion === 'cupón_1200') {
        // Flujo 1.B: Cupón CHARGE_GO (1200 Bs)
        const casoId = generarCasoId();
        const observaciones = 'Cupón CHARGE_GO entregado — 30 min';
        
        try {
          await set(ref(db, 'casos_atencion/' + chatId), {
            id: chatId,
            caso_id: casoId,
            tipo: 'CUPON_CHARGE_GO',
            fecha: formatearFechaAhora(),
            usuario: oldChat.name || 'Sin nombre',
            telefono: chatId,
            monto: '1200',
            observaciones,
            estado: 'Atendido',
          });
        } catch (e) {
          console.error('[CASO_ATENCION] Error guardando CUPON_CHARGE_GO:', e);
        }
        
        const respuesta = `Ese monto de **1.200 Bs** no corresponde al depósito de garantía (que es de **12.000 Bs**), por eso no te lo reconoce. Pero ¡no te preocupes! Ya te lo convertí en un **cupón de 30 minutos gratis** 😊.
Para usarlo:
1. Abre la app.
2. Ve al **menú** (arriba a la derecha).
3. Toca en **'Cupones'**.
4. Selecciona **'Agregar código promocional'** y escribe: \`CHARGE_GO\`.
5. Presiona **'Agregar código promocional**.
Eso sí: para retirar el power bank, haz el proceso normal con tu depósito de garantía. **Lo único que cambia es que esos 30 minutos no te descuentan saldo, sino que consumen el cupón**. **Tu caso (ID: ${casoId}) ya está registrado**. ¡Listo! Cualquier duda, me dices. 💚`;
        
        await sendWhapi(chatId, respuesta);
        await saveAgentMessage(db, chatId, respuesta);
        
        try {
          await update(chatEstRef, { estado: { flow: 'menu' } });
        } catch (e) {}
        
        return NextResponse.json({ success: true });
      }
      
      if (clasificacion === 'reembolso_real') {
        // Flujo 2.B: Reembolso real (1201-11999 Bs) - cambiar a flujo reembolso
        try {
          await update(chatEstRef, { estado: { flow: 'reembolso', montoReembolso: monto } });
        } catch (e) {}
        activeFlow = 'reembolso';
        // Continuar al flujo de reembolso normal (dejar que la IA maneje)
      }
      
      if (clasificacion === 'fuera_rango') {
        const respuesta = 'Ese monto no entra en los rangos de reembolso estándar. ¿Podrías confirmar el monto exacto o contarme qué pasó? 🤔';
        await sendWhapi(chatId, respuesta);
        await saveAgentMessage(db, chatId, respuesta);
        return NextResponse.json({ success: true });
      }
    }

    // --- FLUJO: publicidad_dooh ---
    if (activeFlow === 'publicidad_dooh') {
      // Usar estadoActual ya actualizado con captura de datos
      const chatEstado = estadoActual;
      
      if (!chatEstado.marca || !chatEstado.plan) {
        // Paso 1: Pedir marca y plan
        const pregunta = `¡Qué bien! 😊 Las pantallas de VOLTAJE PLUS están en estaciones de alto tráfico. Tenemos planes:
- **Estándar 24**: 24 exposiciones/día
- **Premium 43**: 43 exposiciones/día
- **Dominancia Exclusiva**: 100% de la pantalla
¿Qué marca/empresa quieres publicitar y qué plan te interesa?`;
        
        await sendWhapi(chatId, pregunta);
        await saveAgentMessage(db, chatId, pregunta);
        
        try {
          await update(chatEstRef, { estado: { flow: 'publicidad_dooh', waitingFor: 'marca_plan' } });
        } catch (e) {}
        return NextResponse.json({ success: true });
      }
      
      // Paso 2: Usuario ya dio marca y plan - guardar caso
      const casoId = generarCasoId();
      const observaciones = `Marca/empresa: ${chatEstado.marca || 'no especificada'}. Plan: ${chatEstado.plan || 'sin definir'}.`;
      
      try {
        await set(ref(db, 'casos_atencion/' + chatId), {
          id: chatId,
          caso_id: casoId,
          tipo: 'PUBLICIDAD_DOOH',
          fecha: formatearFechaAhora(),
          usuario: oldChat.name || 'Sin nombre',
          telefono: chatId,
          observaciones,
          estado: 'Pendiente',
        });
      } catch (e) {
        console.error('[CASO_ATENCION] Error guardando PUBLICIDAD_DOOH:', e);
      }
      
      const respuesta = `¡Listo! Tu solicitud (ID: ${casoId}) está registrada. Te contactaremos para cerrar detalles. 💚`;
      await sendWhapi(chatId, respuesta);
      await saveAgentMessage(db, chatId, respuesta);
      
      try {
        await update(chatEstRef, { estado: { flow: 'menu' } });
      } catch (e) {}
      
      return NextResponse.json({ success: true });
    }

    // --- FLUJO: estacion_gratis ---
    if (activeFlow === 'estacion_gratis') {
      const chatEstado = estadoActual;
      
      if (!chatEstado.negocio || !chatEstado.zona) {
        // Paso 1: Pedir negocio y zona
        const pregunta = `¡Genial! 😊 Una estación gratis atrae clientes y no te cuesta nada. ¿Cuál es el nombre de tu negocio y en qué zona/dirección está?`;
        
        await sendWhapi(chatId, pregunta);
        await saveAgentMessage(db, chatId, pregunta);
        
        try {
          await update(chatEstRef, { estado: { flow: 'estacion_gratis', waitingFor: 'negocio_zona' } });
        } catch (e) {}
        return NextResponse.json({ success: true });
      }
      
      // Paso 2: Guardar caso
      const casoId = generarCasoId();
      const observaciones = `Negocio: ${chatEstado.negocio}. Dirección/zona: ${chatEstado.zona}.`;
      
      try {
        await set(ref(db, 'casos_atencion/' + chatId), {
          id: chatId,
          caso_id: casoId,
          tipo: 'ESTACION_GRATIS',
          fecha: formatearFechaAhora(),
          usuario: chatEstado.negocio,
          telefono: chatId,
          observaciones,
          estado: 'Pendiente',
        });
      } catch (e) {
        console.error('[CASO_ATENCION] Error guardando ESTACION_GRATIS:', e);
      }
      
      const respuesta = `¡Perfecto! Tu solicitud (ID: ${casoId}) está registrada. Un asesor te contactará para coordinar la instalación. 💚`;
      await sendWhapi(chatId, respuesta);
      await saveAgentMessage(db, chatId, respuesta);
      
      try {
        await update(chatEstRef, { estado: { flow: 'menu' } });
      } catch (e) {}
      
      return NextResponse.json({ success: true });
    }

    // --- FLUJO: estacion_evento ---
    if (activeFlow === 'estacion_evento') {
      const chatEstado = estadoActual;
      
      const necesita = ['tipoEvento', 'fecha', 'ubicacion', 'asistentes'].filter(k => !chatEstado[k]);
      
      if (necesita.length > 0) {
        // Paso 1 o intermedio: Pedir datos faltantes
        let pregunta = '';
        if (necesita.length === 4) {
          pregunta = `¡Claro! 😊 Para tu evento necesito: **tipo de evento**, **fecha(s)**, **ubicación** y **número de asistentes aprox.**`;
        } else {
          const labels: Record<string, string> = {
            tipoEvento: 'tipo de evento',
            fecha: 'fecha(s)',
            ubicacion: 'ubicación',
            asistentes: 'número de asistentes aprox.',
          };
          pregunta = `Me falta: ${necesita.map(k => labels[k]).join(', ')}. ¿Me los das? 😊`;
        }
        
        await sendWhapi(chatId, pregunta);
        await saveAgentMessage(db, chatId, pregunta);
        
        try {
          await update(chatEstRef, { estado: { flow: 'estacion_evento', waitingFor: 'datos_evento' } });
        } catch (e) {}
        return NextResponse.json({ success: true });
      }
      
      // Paso 2: Guardar caso
      const casoId = generarCasoId();
      const observaciones = `Tipo de evento: ${chatEstado.tipoEvento}. Fecha(s): ${chatEstado.fecha}. Ubicación: ${chatEstado.ubicacion}. Asistentes: ${chatEstado.asistentes}.`;
      
      try {
        await set(ref(db, 'casos_atencion/' + chatId), {
          id: chatId,
          caso_id: casoId,
          tipo: 'ESTACION_EVENTO',
          fecha: formatearFechaAhora(),
          usuario: oldChat.name || 'Sin nombre',
          telefono: chatId,
          observaciones,
          estado: 'Pendiente',
        });
      } catch (e) {
        console.error('[CASO_ATENCION] Error guardando ESTACION_EVENTO:', e);
      }
      
      const respuesta = `¡Listo! Tu solicitud (ID: ${casoId}) está registrada. Te contactaremos con disponibilidad y costos. 💚`;
      await sendWhapi(chatId, respuesta);
      await saveAgentMessage(db, chatId, respuesta);
      
      try {
        await update(chatEstRef, { estado: { flow: 'menu' } });
      } catch (e) {}
      
      return NextResponse.json({ success: true });
    }

    // --- FLUJO: agente_humano ---
    if (activeFlow === 'agente_humano') {
      const chatEstado = estadoActual;
      
      if (!chatEstado.nombre || !chatEstado.motivo) {
        // Paso 1: Pedir nombre y motivo
        const pregunta = `¡Claro! 😊 Para conectarte con un compañero, dime brevemente: **tu nombre** y **el motivo**.`;
        
        await sendWhapi(chatId, pregunta);
        await saveAgentMessage(db, chatId, pregunta);
        
        try {
          await update(chatEstRef, { estado: { flow: 'agente_humano', waitingFor: 'nombre_motivo' } });
        } catch (e) {}
        return NextResponse.json({ success: true });
      }
      
      // Paso 2: Guardar caso (Estado = Atendido)
      const casoId = generarCasoId();
      const observaciones = `Motivo: ${chatEstado.motivo}.`;
      
      try {
        await set(ref(db, 'casos_atencion/' + chatId), {
          id: chatId,
          caso_id: casoId,
          tipo: 'AGENTE_HUMANO',
          fecha: formatearFechaAhora(),
          usuario: chatEstado.nombre,
          telefono: chatId,
          observaciones,
          estado: 'Atendido',
        });
      } catch (e) {
        console.error('[CASO_ATENCION] Error guardando AGENTE_HUMANO:', e);
      }
      
      const respuesta = `¡Listo! Tu caso (ID: ${casoId}) está registrado. Te atiende un compañero al **0412-685-1090** (https://wa.me/584126851090). ¡Gracias! 💚`;
      await sendWhapi(chatId, respuesta);
      await saveAgentMessage(db, chatId, respuesta);
      
      try {
        await update(chatEstRef, { estado: { flow: 'menu' } });
      } catch (e) {}
      
      return NextResponse.json({ success: true });
    }

    // --- FLUJO: otra_consulta ---
    if (activeFlow === 'otra_consulta') {
      const respuesta = `Por este canal solo veo esas 6 opciones. Si es algo distinto, escríbenos al Instagram @voltajeplus o al 0412-685-1090. ¡Gracias! 💚`;
      await sendWhapi(chatId, respuesta);
      await saveAgentMessage(db, chatId, respuesta);
      
      try {
        await update(chatEstRef, { estado: { flow: 'menu' } });
      } catch (e) {}
      
      return NextResponse.json({ success: true });
    }

    // Persistimos el flujo actual para la siguiente iteraciÃ³n (best-effort).
    try {
      await update(chatEstRef, { estado: { flow: activeFlow } });
    } catch (e) {
      console.log('[MENU] persist flow failed:', e);
    }

    // === 7. Generate AI response ===
    // Reutilizamos allMsgs ya obtenido más arriba

    // Priorizamos SIEMPRE la identidad + flujo del CÃ“DIGO (son la fuente de
    // verdad), para que la personalidad y las respuestas del CEO apliquen.
    const basePrompt = SONIA_IDENTITY;
    const flowInstructions = getFlowPrompt(activeFlow);
    const recent = allMsgs.slice(-8).map(m => (m.sender === 'agent' ? 'A' : 'U') + ': ' + m.content).join('\n');
    const fullPrompt = basePrompt + '\n\n' + flowInstructions + '\n\nHistorial:\n' + recent + '\n\nUsuario: ' + customMsgForAI;

    console.log('[AI] Calling AI... (flow:', activeFlow + ')');
    const reply = await callAI(fullPrompt, 0.4);
    console.log('[AI] Reply:', reply ? reply.substring(0, 100) : 'NO REPLY');

    if (!reply) return NextResponse.json({ success: true });

    // === 8. Send via WHAPI (with verification) ===
    console.log('[WHAPI] Sending to:', toWhatsAppId(chatId));
    const whapiOk = await sendWhapi(chatId, reply);
    const whapiLive = whapiOk;
    console.log('[WHAPI] Response:', whapiLive ? 'sent' : 'FAILED');

    // === 9. Save AI response ===
    await saveAgentMessage(db, chatId, reply);

    // === 10. Auto-Extraction / Auto-Save of Refund Case ===
    // FIX (17/08/2026): disparo flexible (regex) + guard de flujo reembolso +
    // guardado tolerante (ya no se descarta el caso si la cuenta no tiene 20 dígitos)
    // + aviso de corrección de cuenta con conteo exacto + actualización del caso
    // cuando el usuario corrige el número de cuenta.
    const registrationRegex = /(?:caso|solicitud|reembolso)[^.]{0,50}registrad|registrad[^.]{0,50}(?:caso|solicitud|reembolso)/i;
    const isRegistrationConfirmation = activeFlow === 'reembolso' && registrationRegex.test(reply);

    // ¿El usuario ya envió algo que parece una cuenta bancaria (16-25 dígitos)?
    const userRecentText = allMsgs.slice(-6).filter(m => m.sender === 'user').map(m => m.content).join(' ');
    const userHasAccountLike = /\d{16,25}/.test(userRecentText);

    // Disparamos extracción si: Sonia confirmó el caso, O el usuario ya aportó un
    // número que parece cuenta en flujo de reembolso (captura temprana + corrección).
    // También extraer para flujo de 1200bs (tanto reembolso como cupón)
    const shouldExtract = isRegistrationConfirmation || 
                         (activeFlow === 'reembolso' && userHasAccountLike) ||
                         (estado.flow === 'reembolso_1200_error' && estado.optionChosen);

    if (shouldExtract) {
      try {
        console.log('[AI] Extracting user data (confirm:', isRegistrationConfirmation, '| account-like:', userHasAccountLike, ')');

        // Cargar caso existente para preservar caso_id / fecha_primer_contacto y
        // detectar si venía pendiente de corrección.
        let existingCaso: any = null;
        try {
          const existingSnap = await get(ref(db, 'casos_reembolso/' + chatId));
          existingCaso = existingSnap.val();
        } catch (e) {
          console.log('[DB] No existing caso (or read failed):', e);
        }
        const wasPendingCorrection = !!(existingCaso && existingCaso.extraccion && existingCaso.extraccion.cuenta_pendiente_correccion);

        const extractRecent = allMsgs.slice(-15).map(m => (m.sender === 'agent' ? 'A' : 'U') + ': ' + m.content).join('\n');
        const todayStr = new Date().toLocaleDateString('es-VE'); // Fecha actual por si dice "hoy"
        const extractPrompt = `Extrae los datos a partir del historial. Devuelve UNICAMENTE un JSON valido sin Markdown. Si no encuentras algun dato, deja el valor en blanco (""). Fecha de hoy: ${todayStr}.\n\nHistorial:\n${extractRecent}\n\nFormato JSON esperado:\n{\n  "nombre_completo": "...",\n  "cedula": "...",\n  "telefono": "...",\n  "numero_cuenta": "...",\n  "tipo_cuenta": "...",\n  "ubicacion_estacion": "...",\n  "fecha_alquiler": "Convierte cualquier formato de fecha del usuario (ej: 'hoy', 'ayer', '04/08', '4 de agosto') a formato DD/MM/YYYY exacto (ej. ${todayStr})",\n  "hora_alquiler": "Extrae la hora exacta mencionada (ej. 10:00 a.m. o 02:30 p.m.)",\n  "referencia_bancaria": "...",\n  "monto_reembolso": "..."\n}\n\nREGLA IMPORTANTE: si el usuario mencionó varios números de cuenta, usa el ÚLTIMO que haya enviado el usuario como numero_cuenta.`;

        let userData: any = null;
        const extRes = await callAI(extractPrompt, 0.1, true);

        if (extRes) {
          let jsonText = extRes.replace(/```json/gi, '').replace(/```/gi, '').trim();
          if (jsonText) {
            try { userData = JSON.parse(jsonText); }
            catch (e) { console.error('[DB] JSON parse failed, saving partial case:', e); }
          }
        }

        const rawAccount = ((userData && userData.numero_cuenta) || '').replace(/\D/g, '');
        const cuentaCompleta = rawAccount.length === 20;
        const casoId = (existingCaso && existingCaso.caso_id) || 'CASO-' + Date.now().toString().slice(-8);
        const ex = existingCaso && existingCaso.datos_usuario ? existingCaso.datos_usuario : {};

        // Determinar si es caso de cupón CHARGE_GO
        const isCuponCase = estado.flow === 'reembolso_1200_error' && estado.optionChosen === 'cupon';
        const observaciones = isCuponCase ? 'cupón CHARGE_GO' : '';
        
        // Para caso de cupón, el monto es siempre 1200 Bs
        const finalMonto = isCuponCase ? '1200' : (userData && userData.monto_reembolso) || ex.monto_reembolso || '';

        const newCaso = {
           id: chatId,
           caso_id: casoId,
           fecha_primer_contacto: (existingCaso && existingCaso.fecha_primer_contacto) || new Date().toISOString(),
           fecha_registro_caso: new Date().toISOString(),
           datos_usuario: {
             nombre_completo: (userData && userData.nombre_completo) || ex.nombre_completo || oldChat.name || '',
             cedula: (userData && userData.cedula) || ex.cedula || '',
             telefono: (userData && userData.telefono) || chatId,
             numero_cuenta: rawAccount || ex.numero_cuenta || '',
             tipo_cuenta: (userData && userData.tipo_cuenta) || ex.tipo_cuenta || '',
             ubicacion_estacion: (userData && userData.ubicacion_estacion) || ex.ubicacion_estacion || '',
             fecha_alquiler: (userData && userData.fecha_alquiler) || ex.fecha_alquiler || '',
             hora_alquiler: (userData && userData.hora_alquiler) || ex.hora_alquiler || '',
             referencia_bancaria: (userData && userData.referencia_bancaria) || ex.referencia_bancaria || '',
             monto_reembolso: finalMonto
           },
           estado_caso: 'pendiente_validacion',
           atendido: false,
           observaciones: observaciones,
           extraccion: {
             cuenta_completa: cuentaCompleta,
             fallo_llm: userData ? false : true,
             cuenta_pendiente_correccion: !cuentaCompleta && rawAccount.length > 0,
             cuenta_actualizada: wasPendingCorrection && cuentaCompleta,
             tipo_caso: isCuponCase ? 'cupon_charge_go' : 'reembolso'
           }
        };
        await set(ref(db, 'casos_reembolso/' + chatId), newCaso);
        console.log('[DB] Caso guardado/actualizado:', casoId, '| cuenta 20 digitos:', cuentaCompleta, '| pendiente correccion:', newCaso.extraccion.cuenta_pendiente_correccion, '| actualizada:', newCaso.extraccion.cuenta_actualizada);

        // También guardar en la nueva tabla unificada "casos_atencion" para reembolsos
        if (!isCuponCase) {
          try {
            await set(ref(db, 'casos_atencion/' + chatId), {
              id: chatId,
              caso_id: casoId,
              tipo: 'REEMBOLSO',
              fecha: formatearFechaAhora(),
              usuario: newCaso.datos_usuario.nombre_completo || oldChat.name || 'Sin nombre',
              cedula: newCaso.datos_usuario.cedula,
              telefono: chatId,
              cuenta: newCaso.datos_usuario.numero_cuenta + (newCaso.datos_usuario.tipo_cuenta ? ` (${newCaso.datos_usuario.tipo_cuenta})` : ''),
              ubicacion: newCaso.datos_usuario.ubicacion_estacion,
              monto: finalMonto,
              observaciones: `Motivo: ${observaciones || 'Reembolso por falla/cargo indebido'}.`,
              estado: 'Pendiente',
            });
          } catch (e) {
            console.error('[CASO_ATENCION] Error guardando REEMBOLSO:', e);
          }
        }

        // Si la cuenta no está completa (y detectamos algunos dígitos), avisar al
        // usuario con el conteo exacto para que corrija. Solo la primera vez que
        // queda pendiente (no repetir en cada mensaje posterior).
        if (!cuentaCompleta && rawAccount.length > 0 && !wasPendingCorrection) {
          const copy = buildCuentaCorrectionCopy(rawAccount, newCaso.datos_usuario.nombre_completo);
          await sendWhapi(chatId, copy);
          await saveAgentMessage(db, chatId, copy);
        }
      } catch (err) {
        console.error('[EXTRACTION ERROR]', err);
      }
    }

    console.log('[WEBHOOK] === DONE ===');

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[WEBHOOK] ERROR:', e);
    return NextResponse.json({ error: 'Error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode');
  const challenge = req.nextUrl.searchParams.get('hub.challenge');
  if (mode === 'subscribe') return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ ok: true });
}