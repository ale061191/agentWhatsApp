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

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

const SYSTEM_PROMPT = `Eres SONIA de VOLTAJE PLUS.

REGLAS ESTRICTAS:
1. Saludar SOLO una vez al inicio de la conversación
2. NO saludar nunca más después del primer mensaje
3. NO preguntar "¿necesitas algo más?" ni similar
4. NO usar "Entendido"
5. NO hacer notas internas
6. UNA sola respuesta por turno
7. Nunca decir que no puedes ver imágenes
8. Respuestas cortas y amigables

FLUJO DE REEMBOLSO:
- Si el usuario pide reembolso: Pedir las 3 capturas + datos personales/bancarios.
- Si el usuario envía sus datos bancarios y personales: Confirmar "¡Perfecto! ✅ Tu caso de reembolso ha sido registrado exitosamente. Nuestro equipo lo revisará y te contactaremos pronto. ¡Gracias por tu paciencia!"`;

export async function POST(req: NextRequest) {
  console.log('[WEBHOOK] === REQUEST START ===');
  console.log('[WEBHOOK] GOOGLE_API_KEY:', GOOGLE_API_KEY ? 'SET' : 'MISSING');
  console.log('[WEBHOOK] WHAPI_TOKEN:', WHAPI_TOKEN ? 'SET' : 'MISSING');
  
  try {
    const body = await req.json();
    const msgs = body.messages || [];
    console.log('[WEBHOOK] Messages count:', msgs.length);
    console.log('[WEBHOOK] First message:', JSON.stringify(msgs[0]).substring(0, 300));
    
    if (!msgs.length) {
      console.log('[WEBHOOK] No messages, returning 400');
      return NextResponse.json({ error: 'No messages' }, { status: 400 });
    }
    
    const msg = msgs[0];
    console.log('[WEBHOOK] from_me:', msg.from_me);
    
    if (msg.from_me) {
      console.log('[WEBHOOK] Skipping own message');
      return NextResponse.json({ success: true });
    }
    
    const rawPhone = msg.chat_id || msg.from || '';
    const chatId = normalizeChatId(rawPhone);
    console.log('[WEBHOOK] chatId:', chatId);
    
    if (!chatId) {
      console.log('[WEBHOOK] No chatId extracted');
      return NextResponse.json({ error: 'No phone number' }, { status: 400 });
    }
    
    let content = msg.text?.body || '';
    const msgType = msg.type || 'text';
    console.log('[WEBHOOK] content:', content.substring(0, 100));
    console.log('[WEBHOOK] msgType:', msgType);
    
    const db = getFirebaseDB();
    const msgId = (msg.id ? sanitizeKey(msg.id) : 'm_' + Date.now());
    
    // Dedup check
    if (content) {
      const dedupKey = chatId + '/' + simpleHash(content);
      const dedupRef = ref(db, 'system/dedup/' + dedupKey);
      try {
        const dedupResult = await runTransaction(dedupRef, (current) => {
          const now = Date.now();
          if (current && typeof current === 'number' && (now - current) < 20000) return current;
          return now;
        });
        if (dedupResult.committed) {
          const val = dedupResult.snapshot.val();
          if (typeof val === 'number' && val !== Date.now()) {
            console.log('[WEBHOOK] DEDUP: Same content ignored');
            return NextResponse.json({ success: true });
          }
        }
      } catch (e) {
        console.log('[WEBHOOK] DEDUP error, proceeding:', e);
      }
    }
    
    // Save message to Firebase
    const chatSnap = await get(child(ref(db), 'chats/' + chatId));
    let oldChat = chatSnap.val() || {};
    
    if (!oldChat.name) {
      const pushName = msg.from_name || msg.sender?.pushname || msg.sender?.name || msg.pushname || msg.notify;
      if (pushName) {
        await update(ref(db, 'chats/' + chatId), { name: pushName });
        oldChat.name = pushName;
      }
    }
    
    const msgData: Message = { id: msgId, chatId, content: content || '[Imagen]', sender: 'user', timestamp: Date.now(), status: 'delivered' };
    await set(ref(db, 'messages/' + chatId + '/' + msgId), msgData);
    await update(ref(db, 'chats/' + chatId), {
      phone: chatId,
      lastMessage: content || '[Imagen]',
      lastMessageTime: Date.now(),
      unreadCount: (oldChat.unreadCount || 0) + 1,
      aiEnabled: oldChat.aiEnabled !== false
    });
    console.log('[WEBHOOK] Message saved to Firebase');
    
    // Call Gemini
    const histSnap = await get(child(ref(db), 'messages/' + chatId));
    const allMsgs = Object.values(histSnap.val() || {}).sort((a: any, b: any) => a.timestamp - b.timestamp) as Message[];
    
    let customPrompt = '';
    try {
      const pSnap = await get(child(ref(db), 'system/prompt'));
      if (pSnap.exists()) customPrompt = pSnap.val() || '';
    } catch {}
    const prompt = customPrompt || SYSTEM_PROMPT;
    const recent = allMsgs.slice(-10).map(m => (m.sender === 'agent' ? 'A' : 'U') + ': ' + m.content).join('\n');
    const fullPrompt = prompt + '\n\nHistorial:\n' + recent + '\n\nUsuario: ' + content;
    
    console.log('[AI] Calling Gemini...');
    
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GOOGLE_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { temperature: 0.7 } })
    });
    
    if (!res.ok) {
      const errBody = await res.text();
      console.error('[AI] Gemini error:', res.status, errBody);
      return NextResponse.json({ success: false, error: 'Gemini error' });
    }
    
    const data = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('[AI] Reply from Gemini:', reply ? reply.substring(0, 100) : 'NO REPLY');
    
    if (!reply) {
      console.error('[AI] No reply text');
      return NextResponse.json({ success: true });
    }
    
    // Send to WhatsApp
    console.log('[WHAPI] Sending to:', toWhatsAppId(chatId));
    const whapiRes = await fetch(WHAPI_BASE_URL + '/messages/text', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toWhatsAppId(chatId), body: reply })
    });
    
    const whapiData = await whapiRes.json();
    console.log('[WHAPI] Response:', whapiRes.status, JSON.stringify(whapiData).substring(0, 200));
    
    if (!whapiRes.ok) {
      console.error('[WHAPI] Send failed:', whapiRes.status);
    }
    
    // Save AI response
    const aiId = 'a_' + Date.now();
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
