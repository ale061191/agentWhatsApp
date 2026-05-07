import { NextRequest, NextResponse } from 'next/server';
import { Message } from '@/types';
import { getFirebaseDB } from '@/lib/firebase';
import { ref, set, get, child, update } from 'firebase/database';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

const SYSTEM_PROMPT = `Eres SONIA de VOLTAJE PLUS. REGLAS: 1.Saludar SOLO una vez al inicio 2.NO saludar nunca más 3.NO preguntar si necesita algo más 4.NO usar "Entendido" 5.NO notas internas 6.UNA respuesta por turno 7.Nunca decir que no puedes ver imágenes 8.Si el usuarioda los datos: "¡Perfecto! ✅ Caso registrado. Te contactaremos". FLUJO: Si pide reembolsos: "Lamentamos🙏. Necesitamos: 1)📱Captura app 2)👛Captura billetera 3)🏦Captura banco + Tus datos". Si envía imágenes: callar hasta tener 3. Si tiene todo: confirmar caso.`;

/**
 * Normalizes a phone number for use as a chatId and for WHAPI.
 * Strips the @s.whatsapp.net suffix and any non-digit characters.
 * Keeps the FULL international number (with country code).
 */
function normalizeChatId(rawPhone: string): string {
  return rawPhone
    .replace('@s.whatsapp.net', '')
    .replace('@c.us', '')
    .replace(/\D/g, '');
}

/**
 * Detects if a message indicates the user will send info soon.
 * Examples: "ya los envío", "en un momento", "dame un segundo", etc.
 */
function isUserSayingWillSendSoon(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const patterns = [
    /ya\s+(los?\s+)?env[ií]/,         // "ya los envío", "ya envío"
    /en\s+un\s+momento/,              // "en un momento"
    /dame\s+(un\s+)?(momento|segundo|minuto)/, // "dame un momento"
    /ahorita/,                         // "ahorita"
    /un\s+(momento|segundo|minuto)/,   // "un momento"
    /ya\s+v(oy|a)\s/,                 // "ya voy a enviar"
    /espera/,                          // "espera"
    /ya\s+cas[iy]/,                    // "ya casi"
    /lo\s+env[ií]o/,                   // "lo envío"
    /los?\s+mand[oa]/,                // "los mando"
    /voy\s+a\s+enviar/,               // "voy a enviar"
    /voy\s+a\s+mandar/,               // "voy a mandar"
    /enseguida/,                       // "enseguida"
    /ya\s+mismo/,                      // "ya mismo"
    /dame\s+chance/,                   // "dame chance"
    /un\s+ratico/,                     // "un ratico"
    /permiso/,                         // "permiso"
    /déjame/,                          // "déjame buscar"
    /dejame/,                          // "dejame buscar"
    /estoy\s+buscando/,               // "estoy buscando"
    /busco\s+y/,                       // "busco y te envío"
  ];
  return patterns.some(p => p.test(lower));
}

/**
 * Detects if a message looks like the user is sending their personal/banking data.
 * Returns true if the message contains at least 2 data indicators.
 */
function looksLikeUserData(text: string): boolean {
  let score = 0;
  if (/[A-Z][a-záéíóúñ]+\s+[A-Z][a-záéíóúñ]+/.test(text)) score++; // Name pattern
  if (/\d{5,8}/.test(text)) score++;     // Cedula
  if (/0\d{10}/.test(text)) score++;     // Phone
  if (/\d{20}/.test(text)) score++;      // Account number
  if (/corriente|ahorro/i.test(text)) score++; // Account type
  if (/cedula|cédula|nombre|cuenta|telefono|teléfono/i.test(text)) score++; // Keywords
  return score >= 2;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const msgs = body.messages || [];
    if (!msgs.length) return NextResponse.json({ error: 'No messages' }, { status: 400 });
    
    const msg = msgs[0];
    if (msg.from_me) return NextResponse.json({ success: true });
    
    // Extract phone: prefer chat_id, fallback to from
    const rawPhone = msg.chat_id || msg.from || '';
    const chatId = normalizeChatId(rawPhone);
    
    if (!chatId) {
      console.error('[WEBHOOK] Could not extract phone number from message:', JSON.stringify(msg).substring(0, 200));
      return NextResponse.json({ error: 'No phone number' }, { status: 400 });
    }
    
    let content = msg.text?.body || '';
    const msgType = msg.type || 'text';
    
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
    const isWaitingForData = oldChat.waitingForData === true;
    
    if (isImageMsg) {
      imgCount = imgCount + 1;
      const msgData: Message = { id: msgId, chatId, content: '[Imagen] #' + imgCount, sender: 'user', timestamp: Date.now(), status: 'delivered' };
      await set(ref(db, 'messages/' + chatId + '/' + msgId), msgData);
      await update(ref(db, 'chats/' + chatId), { 
        phone: chatId,
        lastMessage: '[Imagen]', 
        lastMessageTime: Date.now(), 
        unreadCount: (oldChat.unreadCount || 0) + 1, 
        imageCount: imgCount 
      });
      
      console.log('[IMG] Count:', imgCount, '/3');
      
      // If less than 3 images, save silently and don't call AI
      if (imgCount < 3) {
        console.log('[IMG] Waiting for more images...');
        return NextResponse.json({ success: true });
      }
      
      // Got 3 images! Now reset count and trigger AI to ask for data
      console.log('[IMG] Got 3! Triggering AI to request data...');
      content = '[Sistema: El usuario ha enviado 3 imágenes. Ahora debe pedir los datos personales y bancarios.]';
      // Reset image count and set waitingForData flag
      await update(ref(db, 'chats/' + chatId), { imageCount: 0, waitingForData: true });
    }
    
    // If we're waiting for data and this is NOT the 3-images trigger...
    if (isWaitingForData && !content.startsWith('[Sistema:')) {
      
      // Save the message to Firebase regardless
      const msgData: Message = { id: msgId, chatId, content, sender: 'user', timestamp: Date.now(), status: 'delivered' };
      await set(ref(db, 'messages/' + chatId + '/' + msgId), msgData);
      await update(ref(db, 'chats/' + chatId), { 
        phone: chatId,
        lastMessage: content, 
        lastMessageTime: Date.now(), 
        unreadCount: (oldChat.unreadCount || 0) + 1 
      });
      
      // Check if user is sending their actual data
      if (looksLikeUserData(content)) {
        console.log('[WAITING] User sent data! Processing normally...');
        // Clear the waiting flag - let it continue to AI processing below
        await update(ref(db, 'chats/' + chatId), { waitingForData: false });
        // Fall through to normal AI processing
      }
      // Check if user says they'll send soon
      else if (isUserSayingWillSendSoon(content)) {
        console.log('[WAITING] User says will send soon, acknowledging briefly...');
        // Clear waiting flag temporarily to let AI respond, then set it back
        // Actually, just respond with a brief acknowledgment and keep waiting
        const briefReply = '¡Perfecto! Sin problema, quedo atenta. Envíame la información cuando la tengas lista. 😊';
        
        // Send to WhatsApp
        await fetch(WHAPI_BASE_URL + '/messages/text', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: chatId, body: briefReply })
        });
        
        // Save to Firebase
        const aiId = 'a_' + Date.now();
        const aiMsg: Message = { id: aiId, chatId, content: briefReply, sender: 'agent', timestamp: Date.now(), status: 'sent' };
        await set(ref(db, 'messages/' + chatId + '/' + aiId), aiMsg);
        console.log('[WAITING] Brief acknowledgment sent');
        
        return NextResponse.json({ success: true });
      }
      // Otherwise, stay silent - just save the message, don't respond
      else {
        console.log('[WAITING] Still waiting for data, staying silent. Message:', content.substring(0, 50));
        return NextResponse.json({ success: true });
      }
    }
    
    // Save message (only if not already saved in the waitingForData block above)
    if (!isWaitingForData || content.startsWith('[Sistema:')) {
      const msgData2: Message = { id: msgId, chatId, content, sender: 'user', timestamp: Date.now(), status: 'delivered' };
      oldChat = (await get(child(ref(db), 'chats/' + chatId))).val() || {};
      const aiEnabled2 = oldChat.aiEnabled !== false;
      await set(ref(db, 'messages/' + chatId + '/' + msgId), msgData2);
      await update(ref(db, 'chats/' + chatId), { 
        phone: chatId,
        lastMessage: content, 
        lastMessageTime: Date.now(), 
        unreadCount: (oldChat.unreadCount || 0) + 1, 
        aiEnabled: aiEnabled2 
      });
    }
    
    // Re-read chat state for aiEnabled check
    oldChat = (await get(child(ref(db), 'chats/' + chatId))).val() || {};
    const aiEnabled = oldChat.aiEnabled !== false;
    
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
      // Clear the waiting flag since we got the data
      await update(ref(db, 'chats/' + chatId), { waitingForData: false });
      console.log('[AUTO] Caso registrado automáticamente');
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
    const recent = allMsgs.slice(-10).map(m => (m.sender === 'agent' ? 'A' : 'U') + ': ' + m.content).join('\n');
    const fullPrompt = prompt + '\n\nHistorial:\n' + recent + '\n\nUsuario: ' + content;
    
    console.log('[AI] Calling Gemini for chatId:', chatId);
    
    if (GOOGLE_API_KEY && WHAPI_TOKEN) {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GOOGLE_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { temperature: 0.7 } })
      });
      
      if (!res.ok) {
        const errBody = await res.text();
        console.error('[AI] Gemini API error:', res.status, errBody);
        return NextResponse.json({ success: false, error: 'Gemini API error' });
      }
      
      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (reply) {
        // Send reply to WhatsApp via WHAPI
        console.log('[WHAPI] Sending reply to:', chatId);
        
        const whapiRes = await fetch(WHAPI_BASE_URL + '/messages/text', {
          method: 'POST',
          headers: { 
            'Authorization': 'Bearer ' + WHAPI_TOKEN, 
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify({ 
            to: chatId, 
            body: reply 
          })
        });
        
        const whapiData = await whapiRes.json();
        
        if (!whapiRes.ok) {
          console.error('[WHAPI] Error sending message:', whapiRes.status, JSON.stringify(whapiData));
        } else {
          console.log('[WHAPI] Message sent successfully:', JSON.stringify(whapiData).substring(0, 100));
        }
        
        // Save AI response to Firebase
        const aiId = 'a_' + Date.now();
        const aiMsg: Message = { id: aiId, chatId, content: reply, sender: 'agent', timestamp: Date.now(), status: 'sent' };
        await set(ref(db, 'messages/' + chatId + '/' + aiId), aiMsg);
        console.log('[AI] Reply saved:', reply.substring(0, 50));
      } else {
        console.error('[AI] No reply text from Gemini. Full response:', JSON.stringify(data).substring(0, 300));
      }
    } else {
      console.error('[CONFIG] Missing GOOGLE_API_KEY or WHAPI_TOKEN');
    }
    
    return NextResponse.json({ success: true });
  } catch (e) { 
    console.error('[ERR] Webhook error:', e); 
    return NextResponse.json({ error: 'Error' }, { status: 500 }); 
  }
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode');
  const challenge = req.nextUrl.searchParams.get('hub.challenge');
  if (mode === 'subscribe') return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ ok: true });
}