import { NextRequest, NextResponse } from 'next/server';
import { Message } from '@/types';
import { getFirebaseDB } from '@/lib/firebase';
import { ref, set, get, child, update } from 'firebase/database';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

const SYSTEM_PROMPT = `Eres SONIA de VOLTAJE PLUS. IMPORTANTE: 1.NO saludar dos veces 2.NO decir "Entendido" 3.NO repetirdatos 4.NO preguntar "¿algo más?" 5.Responder solo lo necesario 6.Si tiene todo ->"¡Perfecto! ✅ Caso registrado". FLUJO: Hola->saludar. Reembolso->pedir 3 imágenes+datos. Imágenes->callar. Datos->confirmar.`;

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
      
      // If less than 3 images, save silently and don't call AI
      if (imgCount < 3) {
        console.log('[IMG] Waiting for more images...');
        return NextResponse.json({ success: true });
      }
      
// Got 3 images! Now reset count and trigger AI to ask for data
      console.log('[IMG] Got 3! Triggering AI to request data...');
      content = '[Sistema: El usuario ha enviado 3 imágenes. Ahora debe pedir los datos personales y bancarios.]';
      // Reset image count AFTER triggering AI
      await update(ref(db, 'chats/' + chatId), { imageCount: 0 });
    }
    
    // Save message
    const msgData: Message = { id: msgId, chatId, content, sender: 'user', timestamp: Date.now(), status: 'delivered' };
    oldChat = (await get(child(ref(db), 'chats/' + chatId))).val() || {};
    const aiEnabled = oldChat.aiEnabled !== false;
    await set(ref(db, 'messages/' + chatId + '/' + msgId), msgData);
    await update(ref(db, 'chats/' + chatId), { lastMessage: content, lastMessageTime: Date.now(), unreadCount: (oldChat.unreadCount || 0) + 1, aiEnabled });
    
    // AUTO-REGISTER CASE: If user sends bank data (name + cedula + phone + account)
    const hasName = /[A-Z][a-z]+\s[A-Z][a-z]+/.test(content);
    const hasCedula = /\d{5,8}/.test(content);
    const hasPhone = /0\d{10}/.test(content);
    const hasAccount = /\d{20}/.test(content);
    const hasCase = (await get(child(ref(db), 'casos_reembolso/' + chatId))).exists();
    
    if (!hasCase && hasName && hasCedula && hasPhone && hasAccount) {
      // Extract data
      const lines = content.split('\n');
      let nombre = 'Usuario', cedula = '', telefono = '', cuenta = '', tipo = 'Corriente';
      for (const line of lines) {
        const clean = line.replace(/\s/g, '');
        if (!nombre && /^[A-Z][a-z]+\s[A-Z][a-z]+/.test(line)) nombre = line;
        if (!telefono && /0\d{10}/.test(clean)) telefono = clean.match(/0\d{10}/)?.[0] || '';
        if (!cuenta && /\d{20,}/.test(clean)) cuenta = clean.match(/\d{20,}/)?.[0] || '';
        if (!cedula && /\d{5,8}/.test(clean) && clean.length < 10) cedula = clean.match(/\d{5,8}/)?.[0] || '';
        if (line.toLowerCase().includes('ahorro')) tipo = 'Ahorro';
      }
      
      // Update chat with user's name
      await update(ref(db, 'chats/' + chatId), { name: nombre, phone: oldChat.phone });
      
      const caso = {
        caso_id: 'CASO-' + Date.now(),
        fecha_primer_contacto: new Date(Date.now() - 30*60000).toISOString(),
        fecha_registro_caso: new Date().toISOString(),
        canal: 'WhatsApp',
        agente: 'SONIA',
        datos_usuario: { nombre_completo: nombre, cedula, telefono, numero_cuenta: cuenta, tipo_cuenta: tipo },
       estado_caso: 'pendiente_validacion',
        estado_validacion: 'completado'
      };
      await set(ref(db, 'casos_reembolso/' + chatId), caso);
      console.log('[AUTO] Caso y nombre registrados');
    }
    
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
    const recent = allMsgs.slice(-6).map(m => (m.sender === 'agent' ? 'A:' : 'U:') + ' ' + m.content).join('\n');
    const fullPrompt = prompt + '\n\nMensajes recientes:\n' + recent + '\n\nNuevo mensaje del usuario: ' + content;
    
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