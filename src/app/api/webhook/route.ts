import { NextRequest, NextResponse } from 'next/server';
import { Message } from '@/types';
import { getFirebaseDB } from '@/lib/firebase';
import { ref, set, get, child, update } from 'firebase/database';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

const SYSTEM_PROMPT = `Eres SONIA de VOLTAJE PLUS. FLUJO: SALUDAR una vez: "¡Hola! 👋 Te escribe Sonia.¿En qué te ayudo?". Si pide reembolsos: "Lamentamos🙏. Necesitamos: 1)📱Captura historial app 2)👛Captura billetera 3)🏦Captura banco + Tus datos". VALIDACIÓN: "¡Perfecto! ✅ Caso registrado. Te contactaremos". REGLAS: 1.NO repeat 2.NO saludar dos veces 3.NO notas internas 4.UNA respuesta por turno 5.Nunca decir que no puedes ver imágenes`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const msgs = body.messages || [];
    if (!msgs.length) return NextResponse.json({ error: 'No messages' }, { status: 400 });
    
    const msg = msgs[0];
    if (msg.from_me) return NextResponse.json({ success: true });
    
    const phone = msg.chat_id?.replace('@s.whatsapp.net', '') || msg.from || '';
    let content = msg.text?.body || '';
    const msgType = msg.type || 'text';
    
    const chatId = phone.replace(/\D/g, '').slice(-10);
    const db = getFirebaseDB();
    const msgId = 'm_' + Date.now();
    
    // DETECT IMAGE
    const isImageMsg = msgType === 'image' || 
      content === '[Imagen]' || 
      content.includes('Imagen received') ||
      content.includes('album');
    
    const chatSnap = await get(child(ref(db), 'chats/' + chatId));
    let oldChat = chatSnap.val() || {};
    let imgCount = oldChat.imageCount || 0;
    
    if (isImageMsg) {
      imgCount = imgCount + 1;
      const msgData: Message = { id: msgId, chatId, content: '[Imagen] #' + imgCount, sender: 'user', timestamp: Date.now(), status: 'delivered' };
      await set(ref(db, 'messages/' + chatId + '/' + msgId), msgData);
      await update(ref(db, 'chats/' + chatId), { lastMessage: '[Imagen]', lastMessageTime: Date.now(), unreadCount: (oldChat.unreadCount || 0) + 1, imageCount: imgCount });
      
      console.log('[IMG] Count:', imgCount, '/3');
      
      if (imgCount < 3) {
        return NextResponse.json({ success: true });
      }
      
      // Got 3 images - reset and trigger AI
      imgCount = 0;
      await update(ref(db, 'chats/' + chatId), { imageCount: 0 });
      content = '[Sistema: El usuario ha enviado las 3 imágenes. Solicita datos.]';
    }
    
    // Save message
    const msgData: Message = { id: msgId, chatId, content, sender: 'user', timestamp: Date.now(), status: 'delivered' };
    oldChat = (await get(child(ref(db), 'chats/' + chatId))).val() || {};
    const aiEnabled = oldChat.aiEnabled !== false;
    await set(ref(db, 'messages/' + chatId + '/' + msgId), msgData);
    await update(ref(db, 'chats/' + chatId), { lastMessage: content, lastMessageTime: Date.now(), unreadCount: (oldChat.unreadCount || 0) + 1, aiEnabled });
    
    if (!aiEnabled) return NextResponse.json({ success: true });
    
    // Get history
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
    
    console.log('[AI] Calling...');
    
    if (GOOGLE_API_KEY && WHAPI_TOKEN) {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GOOGLE_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { temperature: 0.7 } })
      });
      
      if (res.ok) {
        const data = await res.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (reply) {
          await fetch(WHAPI_BASE_URL + '/messages/text', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: phone, body: reply })
          });
          const aiId = 'a_' + Date.now();
          const aiMsg: Message = { id: aiId, chatId, content: reply, sender: 'agent', timestamp: Date.now(), status: 'sent' };
          await set(ref(db, 'messages/' + chatId + '/' + aiId), aiMsg);
          console.log('[AI] Reply:', reply.substring(0, 30));
        }
      }
    }
    
    return NextResponse.json({ success: true });
  } catch (e) { console.error('[ERR]', e); return NextResponse.json({ error: 'Error' }, { status: 500 }); }
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode');
  const challenge = req.nextUrl.searchParams.get('hub.challenge');
  if (mode === 'subscribe') return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ ok: true });
}