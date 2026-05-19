import { NextRequest, NextResponse } from 'next/server';
import { Message } from '@/types';
import { getFirebaseDB } from '@/lib/firebase';
import { ref, set, get, child, update, runTransaction } from 'firebase/database';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

async function getContactName(phone: string): Promise<string | null> {
  if (!WHAPI_TOKEN) return null;
  try {
    const res = await fetch(`${WHAPI_BASE_URL}/contacts/${phone}`, {
      headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN, 'Accept': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      return data.pushname || data.name || null;
    }
  } catch (err) {
    console.log('[CONTACT] Could not fetch contact name:', err);
  }
  return null;
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

function normalizeChatId(rawPhone: string): string {
  return rawPhone
    .replace('@s.whatsapp.net', '')
    .replace('@c.us', '')
    .replace(/\D/g, '');
}

function toWhatsAppId(phone: string): string {
  if (phone.includes('@')) return phone;
  const clean = phone.replace(/\D/g, '');
  return clean + '@s.whatsapp.net';
}

function sanitizeKey(key: string): string {
  return key.replace(/[.#$\[\]]/g, '_');
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function isUserSayingWillSendSoon(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const patterns = [
    /ya\s+(los?\s+)?env[ií]/, /en\s+un\s+momento/,
    /dame\s+(un\s+)?(momento|segundo|minuto)/, /ahorita/,
    /un\s+(momento|segundo|minuto)/, /ya\s+v(oy|a)\s/, /espera/,
    /ya\s+cas[iy]/, /lo\s+env[ií]o/, /los?\s+mand[oa]/,
    /voy\s+a\s+enviar/, /voy\s+a\s+mandar/, /enseguida/,
    /ya\s+mismo/, /dame\s+chance/, /un\s+ratico/,
    /déjame/, /dejame/, /estoy\s+buscando/, /busco\s+y/,
  ];
  return patterns.some(p => p.test(lower));
}

function looksLikeUserData(text: string): boolean {
  let score = 0;
  if (/[A-ZÁÉÍÓÚÑa-záéíóúñ]{2,}\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]{2,}/.test(text)) score++;
  if (/\d{5,10}/.test(text)) score++;
  if (/\d{10,}/.test(text)) score++;
  if (/corriente|ahorro/i.test(text)) score++;
  if (/cedula|cédula|nombre|cuenta|telefono|teléfono|banco/i.test(text)) score++;
  if (text.split('\n').length >= 3) score++;
  return score >= 2;
}

async function extractUserDataWithAI(messages: Message[]): Promise<{
  nombre_completo: string;
  cedula: string;
  telefono: string;
  numero_cuenta: string;
  tipo_cuenta: string;
} | null> {
  if (!GOOGLE_API_KEY) return null;
  
  const allRecentMessages = messages
    .slice(-25)
    .map(m => `${m.sender === 'agent' ? 'AGENTE' : 'USUARIO'}: ${m.content}`)
    .join('\n');

  const extractionPrompt = `Analiza esta conversación de WhatsApp y extrae los datos personales y bancarios que el usuario proporcionó.

CONVERSACIÓN:
${allRecentMessages}

INSTRUCCIONES:
- Extrae SOLO los datos que el usuario haya proporcionado explícitamente
- Si un dato NO fue proporcionado, deja el campo vacío ""
- El nombre puede venir en cualquier formato (mayúsculas, minúsculas, etc.)
- La cédula es un número de identidad venezolano (generalmente 6-10 dígitos, puede tener V- o CI: prefijo)
- El teléfono puede venir como 04XX-XXXXXXX, +58XXXXXXXXXX, o similar
- La cuenta bancaria es un número largo (generalmente 20 dígitos)
- El tipo de cuenta es "Corriente" o "Ahorro"

RESPONDE EXACTAMENTE en este formato JSON, sin texto adicional, sin backticks, sin markdown:
{"nombre_completo":"","cedula":"","telefono":"","numero_cuenta":"","tipo_cuenta":""}`;

  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GOOGLE_API_KEY,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: extractionPrompt }] }],
          generationConfig: { temperature: 0.1 }
        })
      }
    );

    if (!res.ok) {
      console.error('[EXTRACT] Gemini error:', res.status);
      return null;
    }

    const data = await res.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (!responseText) return null;
    
    const cleanJson = responseText
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    
    console.log('[EXTRACT] AI extracted data:', cleanJson);
    const parsed = JSON.parse(cleanJson);
    
    if (!parsed.nombre_completo && !parsed.cedula && !parsed.telefono && !parsed.numero_cuenta) {
      console.log('[EXTRACT] No useful data extracted');
      return null;
    }
    
    return {
      nombre_completo: parsed.nombre_completo || '',
      cedula: parsed.cedula || '',
      telefono: parsed.telefono || '',
      numero_cuenta: parsed.numero_cuenta || '',
      tipo_cuenta: parsed.tipo_cuenta || 'Corriente'
    };
  } catch (err) {
    console.error('[EXTRACT] Error parsing AI response:', err);
    return null;
  }
}

async function sendAIReply(db: any, chatId: string, content: string, msgType: string) {
  const chatSnap = await get(child(ref(db), 'chats/' + chatId));
  const chatData = chatSnap.val() || {};
  const aiEnabled = chatData.aiEnabled !== false;
  
  if (!aiEnabled) {
    console.log('[AI] AI disabled for chatId:', chatId);
    return;
  }
  
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
  
  if (!GOOGLE_API_KEY || !WHAPI_TOKEN) {
    console.error('[CONFIG] Missing GOOGLE_API_KEY or WHAPI_TOKEN');
    return;
  }
  
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GOOGLE_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { temperature: 0.7 } })
  });
  
  if (!res.ok) {
    const errBody = await res.text();
    console.error('[AI] Gemini API error:', res.status, errBody);
    return;
  }
  
  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!reply) {
    console.error('[AI] No reply text from Gemini. Full response:', JSON.stringify(data).substring(0, 300));
    return;
  }
  
  console.log('[WHAPI] Sending reply to:', chatId);
  
  const whapiRes = await fetch(WHAPI_BASE_URL + '/messages/text', {
    method: 'POST',
    headers: { 
      'Authorization': 'Bearer ' + WHAPI_TOKEN, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({ 
      to: toWhatsAppId(chatId), 
      body: reply 
    })
  });
  
  const whapiData = await whapiRes.json();
  
  if (!whapiRes.ok) {
    console.error('[WHAPI] Error sending message:', whapiRes.status, JSON.stringify(whapiData));
  } else {
    console.log('[WHAPI] Message sent successfully:', JSON.stringify(whapiData).substring(0, 100));
  }
  
  const aiId = 'a_' + Date.now();
  const aiMsg: Message = { id: aiId, chatId, content: reply, sender: 'agent', timestamp: Date.now(), status: 'sent' };
  await set(ref(db, 'messages/' + chatId + '/' + aiId), aiMsg);
  console.log('[AI] Reply saved:', reply.substring(0, 50));
}

export async function POST(req: NextRequest) {
  console.log('[WEBHOOK] Request received');
  try {
    const body = await req.json();
    const msgs = body.messages || [];
    console.log('[WEBHOOK] Messages count:', msgs.length);
    if (!msgs.length) return NextResponse.json({ error: 'No messages' }, { status: 400 });
    
    const msg = msgs[0];
    console.log('[WEBHOOK] from_me:', msg.from_me, 'type:', msg.type);
    if (msg.from_me) {
      console.log('[WEBHOOK] Skipping own message');
      return NextResponse.json({ success: true });
    }
    
    const rawPhone = msg.chat_id || msg.from || '';
    const chatId = normalizeChatId(rawPhone);
    
    if (!chatId) {
      console.error('[WEBHOOK] Could not extract phone number from message:', JSON.stringify(msg).substring(0, 200));
      return NextResponse.json({ error: 'No phone number' }, { status: 400 });
    }
    
    let content = msg.text?.body || '';
    const msgType = msg.type || 'text';
    
    const db = getFirebaseDB();
    const msgId = (msg.id ? sanitizeKey(msg.id) : 'm_' + Date.now());
    
    if (content) {
      const dedupKey = chatId + '/' + simpleHash(content);
      const dedupRef = ref(db, 'system/dedup/' + dedupKey);
      try {
        const dedupResult = await runTransaction(dedupRef, (current) => {
          const now = Date.now();
          if (current && typeof current === 'number' && (now - current) < 20000) {
            return current;
          }
          return now;
        });
        if (dedupResult.committed) {
          const val = dedupResult.snapshot.val();
          if (typeof val === 'number' && val !== Date.now()) {
            console.log('[DEDUP] Same text content ignored:', content.substring(0, 50));
            return NextResponse.json({ success: true });
          }
        }
      } catch (e) {
        console.log('[DEDUP] Error, proceeding:', e);
      }
    }
    
    if (!content && msg.id) {
      const imgDedupKey = sanitizeKey(msg.id);
      const msgSnap = await get(child(ref(db), 'messages/' + chatId + '/' + imgDedupKey));
      if (msgSnap.exists()) {
        console.log('[WEBHOOK] Duplicate message ignored:', msg.id);
        return NextResponse.json({ success: true });
      }
    }
    
    console.log('[WEBHOOK] msgType:', msgType, '| hasImage:', !!msg.image, '| hasMedia:', !!(msg.image || msg.video || msg.document), '| content:', content?.substring(0, 50));
    
    const isImageMsg = msgType === 'image' || 
      msgType === 'sticker' ||
      !!msg.image ||
      content === '[Imagen]' || 
      content.includes('Imagen received') ||
      content.includes('album') ||
      (msgType !== 'text' && !content && !msg.text);
    
    const chatSnap = await get(child(ref(db), 'chats/' + chatId));
    let oldChat = chatSnap.val() || {};
    let imgCount = oldChat.imageCount || 0;
    const isWaitingForData = oldChat.waitingForData === true;
    
    if (!oldChat.name) {
      const pushName = msg.from_name || msg.sender?.pushname || msg.sender?.name || msg.pushname || msg.notify;
      if (pushName) {
        await update(ref(db, 'chats/' + chatId), { name: pushName });
        oldChat.name = pushName;
        console.log('[CONTACT] Name from msg:', pushName, 'for', chatId);
      } else {
        const contactName = await getContactName(chatId);
        if (contactName) {
          await update(ref(db, 'chats/' + chatId), { name: contactName });
          oldChat.name = contactName;
          console.log('[CONTACT] Name from API:', contactName, 'for', chatId);
        }
      }
    }
    
    if (isImageMsg) {
      const chatRef = ref(db, 'chats/' + chatId);
      let wasExactlyThree = false;
      let newCount = 1;
      
      try {
        const txResult = await runTransaction(child(chatRef, 'imageCount'), (currentCount) => {
          const count = (currentCount || 0) + 1;
          if (count === 3) {
            wasExactlyThree = true;
            return 0;
          }
          return count;
        });
        
        if (txResult.committed) {
          newCount = wasExactlyThree ? 3 : txResult.snapshot.val();
        }
      } catch (err) {
        console.error('[IMG] Transaction failed:', err);
        newCount = imgCount + 1;
        if (newCount === 3) wasExactlyThree = true;
      }

      const msgData: Message = { id: msgId, chatId, content: '[Imagen] #' + newCount, sender: 'user', timestamp: Date.now(), status: 'delivered' };
      await set(ref(db, 'messages/' + chatId + '/' + msgId), msgData);
      await update(chatRef, { 
        phone: chatId,
        lastMessage: '[Imagen]', 
        lastMessageTime: Date.now(), 
        unreadCount: (oldChat.unreadCount || 0) + 1,
      });
      
      console.log('[IMG] Count:', newCount, '/3 (was exactly three:', wasExactlyThree, ')');
      
      if (!wasExactlyThree) {
        console.log('[IMG] Waiting for more images or skipped extra images...');
        return NextResponse.json({ success: true });
      }
      
      console.log('[IMG] Got 3! Triggering AI to request data...');
      content = '[Sistema: El usuario ha enviado 3 imagenes. Ahora debe pedir los datos personales y bancarios.]';
      
      await update(chatRef, { waitingForData: true, lastMessage: '[Imagen 3/3]', lastMessageTime: Date.now() });
    }
    
    if (isWaitingForData) {
      const msgData: Message = { id: msgId, chatId, content, sender: 'user', timestamp: Date.now(), status: 'delivered' };
      await set(ref(db, 'messages/' + chatId + '/' + msgId), msgData);
      await update(ref(db, 'chats/' + chatId), { 
        phone: chatId,
        lastMessage: content, 
        lastMessageTime: Date.now(), 
        unreadCount: (oldChat.unreadCount || 0) + 1 
      });
      
      if (looksLikeUserData(content)) {
        console.log('[WAITING] User sent data! Extracting with AI...');
        
        const histSnap = await get(child(ref(db), 'messages/' + chatId));
        const allMsgs = Object.values(histSnap.val() || {})
          .sort((a: any, b: any) => a.timestamp - b.timestamp) as Message[];
        
        const extractedData = await extractUserDataWithAI(allMsgs);
        
        if (extractedData && (extractedData.nombre_completo || extractedData.cedula || extractedData.numero_cuenta)) {
          console.log('[EXTRACT] Successfully extracted user data:', JSON.stringify(extractedData));
          
          const existingCase = (await get(child(ref(db), 'casos_reembolso/' + chatId))).val();
          
          const caso = {
            caso_id: existingCase?.caso_id || 'CASO-' + Date.now(),
            fecha_primer_contacto: existingCase?.fecha_primer_contacto || new Date().toISOString(),
            fecha_registro_caso: new Date().toISOString(),
            canal: 'WhatsApp',
            agente: 'SONIA',
            datos_usuario: {
              nombre_completo: extractedData.nombre_completo || existingCase?.datos_usuario?.nombre_completo || '',
              cedula: extractedData.cedula || existingCase?.datos_usuario?.cedula || '',
              telefono: extractedData.telefono || existingCase?.datos_usuario?.telefono || '',
              numero_cuenta: extractedData.numero_cuenta || existingCase?.datos_usuario?.numero_cuenta || '',
              tipo_cuenta: extractedData.tipo_cuenta || existingCase?.datos_usuario?.tipo_cuenta || 'Corriente'
            },
            evidencias: existingCase?.evidencias || {
              captura_historial_operaciones: '[Imagen recibida]',
              captura_billetera_app: '[Imagen recibida]',
              captura_movimientos_bancarios: '[Imagen recibida]'
            },
            estado_caso: 'pendiente_validacion',
            estado_validacion: 'completado'
          };
          
          await set(ref(db, 'casos_reembolso/' + chatId), caso);
          console.log('[AUTO] Caso registrado/actualizado con datos extraídos por AI');
        }
        
        await update(ref(db, 'chats/' + chatId), { waitingForData: false });
        
        // Send confirmation directly
        const confirmMsg = '¡Perfecto! ✅ Tu caso de reembolso ha sido registrado exitosamente. Nuestro equipo lo revisará y te contactaremos pronto. ¡Gracias por tu paciencia!';
        await fetch(WHAPI_BASE_URL + '/messages/text', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: toWhatsAppId(chatId), body: confirmMsg })
        });
        const confId = 'a_' + Date.now();
        const confMsg: Message = { id: confId, chatId, content: confirmMsg, sender: 'agent', timestamp: Date.now(), status: 'sent' };
        await set(ref(db, 'messages/' + chatId + '/' + confId), confMsg);
        console.log('[AUTO] Confirmation message sent');
        
        return NextResponse.json({ success: true });
      }
      else if (isUserSayingWillSendSoon(content)) {
        console.log('[WAITING] User says will send soon, acknowledging briefly...');
        const briefReply = '¡Perfecto! Sin problema, quedo atenta. Envíame la información cuando la tengas lista. 😊';
        
        await fetch(WHAPI_BASE_URL + '/messages/text', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + WHAPI_TOKEN!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: toWhatsAppId(chatId), body: briefReply })
        });
        const aiId = 'a_' + Date.now();
        const aiMsg: Message = { id: aiId, chatId, content: briefReply, sender: 'agent', timestamp: Date.now(), status: 'sent' };
        await set(ref(db, 'messages/' + chatId + '/' + aiId), aiMsg);
        console.log('[WAITING] Brief acknowledgment sent');
        
        return NextResponse.json({ success: true });
      }
      else {
        console.log('[WAITING] Still waiting for data, staying silent. Message:', content.substring(0, 50));
        return NextResponse.json({ success: true });
      }
    }
    
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
    
    // Process AI reply synchronously
    await sendAIReply(db, chatId, content, msgType);
    
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
