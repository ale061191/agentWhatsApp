import { NextRequest, NextResponse } from 'next/server';
import { Message } from '@/types';
import { getFirebaseDB } from '@/lib/firebase';
import { Database, ref, set, get, child, update, runTransaction } from 'firebase/database';
import {
  buildMenuText,
  detectFlow,
  getFlowPrompt,
  SONIA_IDENTITY,
  FlowId,
} from '@/lib/menu';

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
async function saveAgentMessage(db: Database, chatId: string, content: string) {
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

/** Envía texto por WhatsApp vía WHAPI y devuelve si fue OK. */
async function sendWhapi(chatId: string, text: string): Promise<boolean> {
  const res = await fetch(WHAPI_BASE_URL + '/messages/text', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: toWhatsAppId(chatId), body: text }),
  });
  return res.ok;
}

/**
 * Genera texto de IA. PRIMERO AGNES (OpenAI-compatible); si no está
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
      const dedupResult = await runTransaction(dedupRef, (current) => {
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
      console.log('[WEBHOOK] AI is DISABLED for this chat — no response sent');
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
        const txResult = await runTransaction(child(chatRef, 'imageCount'), (currentCount) => {
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

    // === 5. DEBOUNCE LOCK — agrupar mensajes rápidos ===
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

      console.log('[LOCK] Lock acquired, debouncing 1500ms');
      await new Promise(resolve => setTimeout(resolve, 1500));
      console.log('[LOCK] Debounce complete, processing batch');

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

    // === 5B. MENÚ / ESTADO DE CONVERSACIÓN ===
    // El estado del flujo se persiste DENTRO de chats/{chatId}/estado (path
    // que el webhook ya usa y las reglas ya permiten), evitando depender de un
    // path nuevo que podría estar bloqueado por las reglas de Firebase.
    const chatEstRef = ref(db, 'chats/' + chatId);
    let estado: { flow?: FlowId } = {};
    try {
      const chatSnap2 = await get(chatEstRef);
      estado = chatSnap2.val()?.estado || {};
    } catch (e) {
      console.log('[MENU] Error reading chat.estado (defaults to menu):', e);
    }

    const userText = (customMsgForAI || '').trim();

    // PRIMER CONTACTO: aún no hay estado registrado → SIEMPRE mostrar el menú
    // de bienvenida una vez, sin importar si el mensaje trae intención clara.
    // (Decisión de Ezequiel 04/08/2026: uniformidad en el primer contacto.)
    if (!estado.flow) {
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
    let activeFlow: FlowId = estado.flow || 'menu';

    if (detected && detected !== estado.flow) {
      activeFlow = detected;
      console.log('[MENU] Flow changed to:', activeFlow);
    } else if (detected === 'menu') {
      activeFlow = 'menu';
    }

    // Persistimos el flujo actual para la siguiente iteración (best-effort).
    try {
      await update(chatEstRef, { estado: { flow: activeFlow } });
    } catch (e) {
      console.log('[MENU] persist flow failed:', e);
    }

    // === 7. Generate AI response ===
    const histSnap = await get(ref(db, 'messages/' + chatId));
    const allMsgs = Object.values(histSnap.val() || {}).sort((a: any, b: any) => a.timestamp - b.timestamp) as Message[];

    // Priorizamos SIEMPRE la identidad + flujo del CÓDIGO (son la fuente de
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

    // === 10. Auto-Extraction of Refund Case ===
    if (reply.toLowerCase().includes('tu caso ha sido registrado')) {
      try {
        console.log('[AI] Registration confirmed, extracting user data...');
        const extractRecent = allMsgs.slice(-15).map(m => (m.sender === 'agent' ? 'A' : 'U') + ': ' + m.content).join('\n');
        const extractPrompt = `Extrae los datos personales y bancarios del usuario a partir del siguiente historial de conversacion. Devuelve UNICAMENTE un JSON valido sin Markdown. Si no encuentras algun dato, deja el valor en blanco ("").\n\nHistorial:\n${extractRecent}\n\nFormato JSON esperado:\n{\n  "nombre_completo": "...",\n  "cedula": "...",\n  "telefono": "...",\n  "numero_cuenta": "...",\n  "tipo_cuenta": "..."\n}`;

        const extRes = await callAI(extractPrompt, 0.1, true);

        if (extRes) {
          let jsonText = extRes;
          jsonText = jsonText.replace(/```json/gi, '').replace(/```/gi, '').trim();

           if (jsonText) {
              const userData = JSON.parse(jsonText);
              const rawAccount = (userData.numero_cuenta || '').replace(/\D/g, '');
              if (rawAccount.length !== 20) {
                console.log('[DB] Skipping case save: account must be 20 digits, got', rawAccount.length);
              } else {
                const casoId = 'CASO-' + Date.now().toString().slice(-8);
                const newCaso = {
                   id: chatId,
                   caso_id: casoId,
                   fecha_primer_contacto: new Date().toISOString(),
                   fecha_registro_caso: new Date().toISOString(),
                   datos_usuario: {
                     nombre_completo: userData.nombre_completo || oldChat.name || '',
                     cedula: userData.cedula || '',
                     telefono: userData.telefono || chatId,
                     numero_cuenta: rawAccount,
                     tipo_cuenta: userData.tipo_cuenta || ''
                   },
                   evidencias: {
                     captura_historial_operaciones: true,
                     captura_billetera_app: true,
                     captura_movimientos_bancarios: true
                   },
                   estado_caso: 'pendiente_validacion'
                };
                await set(ref(db, 'casos_reembolso/' + chatId), newCaso);
                console.log('[DB] Auto-extracted and saved caso de reembolso:', casoId);
              }
           }
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