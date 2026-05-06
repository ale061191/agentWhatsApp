import { NextRequest, NextResponse } from 'next/server';
import { Message } from '@/types';
import { getFirebaseDB } from '@/lib/firebase';
import { ref, set, get, child, update } from 'firebase/database';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

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
    
    // Check for image markers in content
    const hasImageMarker = /\[imagen\]|\[album\]|imagen received|album reci/i.test(content.toLowerCase());
    const isImageType = msgType === 'image';
    
    if (hasImageMarker || isImageType) {
      const msgData: Message = { id: msgId, chatId, content: content || '[Imagen]', sender: 'user', timestamp: Date.now(), status: 'delivered' };
      const chatSnap = await get(child(ref(db), 'chats/' + chatId));
      const oldChat = chatSnap.val() || {};
      await set(ref(db, 'messages/' + chatId + '/' + msgId), msgData);
      await update(ref(db, 'chats/' + chatId), { lastMessage: content || '[Imagen]', lastMessageTime: Date.now(), unreadCount: (oldChat.unreadCount || 0) + 1 });
      console.log('[IMG] Saved silently');
      return NextResponse.json({ success: true });
    }
    
    // Normal text - save and respond with AI
    const msgData: Message = { id: msgId, chatId, content, sender: 'user', timestamp: Date.now(), status: 'delivered' };
    const chatSnap = await get(child(ref(db), 'chats/' + chatId));
    const oldChat = chatSnap.val() || {};
    await set(ref(db, 'messages/' + chatId + '/' + msgId), msgData);
    await update(ref(db, 'chats/' + chatId), { lastMessage: content, lastMessageTime: Date.now(), unreadCount: (oldChat.unreadCount || 0) + 1, aiEnabled: oldChat.aiEnabled !== false });
    
    // AI Response
    if (GOOGLE_API_KEY && WHAPI_TOKEN) {
      let prompt = 'Eres SONIA de VOLTAJE PLUS. Saludar: "¡Hola! 👋 Soy Sonia.¿En qué te ayudo?". Si pide reembolso "Lamentamos🙏. Necesitamos: 1)📱Captura app 2)👛Captura billetera 3)🏦Captura banco + Tus datos". REGLAS: 1.NO repeat 2.NO saludar dos veces 3.UNA respuesta por turno';
      const histSnap = await get(child(ref(db), 'messages/' + chatId));
      const allMsgs = Object.values(histSnap.val() || {}).sort((a: any, b: any) => a.timestamp - b.timestamp) as Message[];
      const recent = allMsgs.slice(-10).map(m => (m.sender === 'agent' ? 'A' : 'U') + ': ' + m.content).join('\n');
      const fullPrompt = prompt + '\n\n' + recent + '\n\nU: ' + content;
      
      console.log('[AI] Calling Gemini for:', content);
      
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
          console.log('[AI] Replied:', reply.substring(0, 30));
        }
      }
    }
    
    return NextResponse.json({ success: true });
  } catch (e) { console.error('[ERROR]', e); return NextResponse.json({ error: 'Error' }, { status: 500 }); }
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode');
  const challenge = req.nextUrl.searchParams.get('hub.challenge');
  if (mode === 'subscribe') return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ ok: true });
}