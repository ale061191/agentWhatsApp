import { NextRequest, NextResponse } from 'next/server';
import { Message } from '@/types';
import { getFirebaseDB } from '@/lib/firebase';
import { ref, set, get, child, update, runTransaction } from 'firebase/database';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

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

const SYSTEM_PROMPT = `Eres SONIA, una asistente virtual profesional, amable y empática del equipo de atención al cliente y soporte al usuario de VOLTAJE PLUS. IDENTIDAD: Nombre: SONIA, Empresa: VOLTAJE PLUS (sistema de power banks en Venezuela), Función: Atención al cliente especializada en reembolsos de la app VOLTAJE PLUS. TONO Y VOZ: Profesional, cercana y empática. Lenguaje claro, cálido y conciso. Hacer sentir al usuario escuchado y valorado. FLUJO: SALUDO INICIAL (solo una vez): '¡Hola! 👋 Te escribe Sonia del equipo de atención al cliente y soporte al usuario de VOLTAJE PLUS. Cuéntame, ¿en qué te puedo ayudar hoy?' DETECCIÓN: Si pide reembolso → continuar. Si pide información de ventas/máquinas/negocio → ENVIAR A OTROS CANALES. Si otra consulta → LIMITACIÓN. SOLICITUD REQUISITOS: 'Lamentamos mucho los inconveniente 🙏. Para gestionar tu caso necesitamos: 1)📱Captura historial app VOLTAJE PLUS 2)👛Captura billetera app 3)🏦Captura movimientos bancarios + Tus datos:Nombre,Cédula,Teléfono,Cuenta,Tipo'. VALIDACIÓN: Cuando tenga todo: '¡Perfecto! ✅ Hemos recibido toda la información. Tu caso ha sido registrado. Te contactaremos pronto. Gracias por tu paciencia! 💚'. VENTAS E INFORMACIÓN: Si el usuario pide información sobre máquinas, el negocio, alianzas o compras: '¡Hola! Qué gusto saludarte. Te comento que este canal es ÚNICA y EXCLUSIVAMENTE para reembolsos. Para información de ventas o máquinas, por favor envíanos un DM al Instagram de VOLTAJE PLUS (@voltajeplus) o visita voltajeplus.com donde encontrarás formularios y el botón a nuestro WhatsApp de Ventas. ¡Allí te ayudarán con mucho gusto! 💚'. LIMITACIÓN: 'Me encantaría ayudarte😊 pero este canal es solo para reembolsos de VOLTAJE PLUS. Para otras consultas contáctanos por otros canales. ¡Gracias! 💚'. ESCALAMIENTO: Transferir a agente humano si lo solicita, caso muy complejo, o frustración extrema. REGLAS: 1.NO inventar información 2.NO atender otros temas 3.SIEMPRE mostrar empatía 4.SIEMPRE esperar todos requisitos antes de confirmar 5.SIEMPRE saludar al inicio 6.Registrar caso en Firebase silenciosamente al tener todo 7.NUNCA mencionar Firebase al usuario 8.NO enviar notas internas como (texto) 9.NO repetir el mismo mensaje 10.NO saludar dos veces 11.NUNCA preguntar números de pedido 12.NUNCA decir que no puedes ver imágenes 13.UNA respuesta por mensaje del usuario`;

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

      // Atomic dedup — only one request wins per msgId
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
    const chatSnap = await get(child(ref(db), 'chats/' + chatId));
    const oldChat = chatSnap.val() || {};

    await update(ref(db, 'chats/' + chatId), {
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

    const isImageMessage = (m: any) => {
      const mType = m.type || 'text';
      const mContent = m.text?.body || '';
      return mType === 'image' || mType === 'sticker' || !!m.image || mContent === '[Imagen]' || mContent.includes('Imagen received') || mContent.includes('album') || (mType !== 'text' && !mContent && !m.text);
    };

    if (msgs.some(isImageMessage)) {
      const chatRef = ref(db, 'chats/' + chatId);
      let newCount = 0;
      let didTrigger = false;

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

    // === 5. Generate AI response ===
    const histSnap = await get(child(ref(db), 'messages/' + chatId));
    const allMsgs = Object.values(histSnap.val() || {}).sort((a: any, b: any) => a.timestamp - b.timestamp) as Message[];

    let customPrompt = '';
    try {
      const pSnap = await get(child(ref(db), 'system/prompt'));
      if (pSnap.exists()) customPrompt = pSnap.val() || '';
    } catch {}
    const prompt = customPrompt || SYSTEM_PROMPT;
    const recent = allMsgs.slice(-8).map(m => (m.sender === 'agent' ? 'A' : 'U') + ': ' + m.content).join('\n');
    const fullPrompt = prompt + '\n\nHistorial:\n' + recent + '\n\nUsuario: ' + customMsgForAI;

    console.log('[AI] Calling Gemini...');
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GOOGLE_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { temperature: 0.7 } })
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('[AI] Gemini error:', res.status, errBody);
      return NextResponse.json({ success: false });
    }

    const data = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('[AI] Reply:', reply ? reply.substring(0, 100) : 'NO REPLY');

    if (!reply) return NextResponse.json({ success: true });

    // === 6. Send via WHAPI ===
    console.log('[WHAPI] Sending to:', toWhatsAppId(chatId));
    const whapiRes = await fetch(WHAPI_BASE_URL + '/messages/text', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toWhatsAppId(chatId), body: reply })
    });
    const whapiData = await whapiRes.json();
    console.log('[WHAPI] Response:', whapiRes.status);

    // === 7. Save AI response ===
    const aiId = 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    await set(ref(db, 'messages/' + chatId + '/' + aiId), {
      id: aiId, chatId, content: reply, sender: 'agent', timestamp: Date.now(), status: 'sent'
    });
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
