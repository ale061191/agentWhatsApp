import { NextRequest, NextResponse } from 'next/server';
import { Message } from '@/types';
import { getFirebaseDB } from '@/lib/firebase';
import { ref, set, get, child, update } from 'firebase/database';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

/**
 * Fetches the contact's pushname (display name) from WHAPI.
 * Returns null if not found.
 */
async function getContactName(phone: string): Promise<string | null> {
  if (!WHAPI_TOKEN) return null;
  try {
    const res = await fetch(`${WHAPI_BASE_URL}/contacts/${phone}@s.whatsapp.net`, {
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
 */
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

/**
 * Detects if a message looks like the user is sending their personal/banking data.
 * Returns true if the message contains at least 2 data indicators.
 */
function looksLikeUserData(text: string): boolean {
  let score = 0;
  // Name pattern: two words with first letter uppercase (or all caps)
  if (/[A-ZÁÉÍÓÚÑa-záéíóúñ]{2,}\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]{2,}/.test(text)) score++;
  if (/\d{5,10}/.test(text)) score++;      // Cedula or phone digits
  if (/\d{10,}/.test(text)) score++;       // Phone or account number
  if (/corriente|ahorro/i.test(text)) score++;  // Account type
  if (/cedula|cédula|nombre|cuenta|telefono|teléfono|banco/i.test(text)) score++;
  // If user sends a multi-line message with several lines of data
  if (text.split('\n').length >= 3) score++;
  return score >= 2;
}

/**
 * Uses Gemini AI to extract structured user data from conversation history.
 * Returns null if data cannot be extracted.
 */
async function extractUserDataWithAI(messages: Message[]): Promise<{
  nombre_completo: string;
  cedula: string;
  telefono: string;
  numero_cuenta: string;
  tipo_cuenta: string;
} | null> {
  if (!GOOGLE_API_KEY) return null;
  
  // Get the last 20 messages from the user (text messages only, skip images/system)
  const userMessages = messages
    .filter(m => m.sender === 'user' && !m.content.startsWith('[Imagen]') && !m.content.startsWith('[Sistema:'))
    .slice(-20)
    .map(m => m.content)
    .join('\n');
  
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
          generationConfig: { temperature: 0.1 }  // Low temp for precision
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
    
    // Clean the response - remove markdown code fences if present
    const cleanJson = responseText
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    
    console.log('[EXTRACT] AI extracted data:', cleanJson);
    const parsed = JSON.parse(cleanJson);
    
    // Validate we got at least some data
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
    
    // Fetch and save contact name if we don't have one yet
    if (!oldChat.name) {
      const contactName = await getContactName(chatId);
      if (contactName) {
        await update(ref(db, 'chats/' + chatId), { name: contactName });
        oldChat.name = contactName;
        console.log('[CONTACT] Saved name:', contactName, 'for', chatId);
      }
    }
    
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
        console.log('[WAITING] User sent data! Extracting with AI...');
        
        // Get full message history for AI extraction
        const histSnap = await get(child(ref(db), 'messages/' + chatId));
        const allMsgs = Object.values(histSnap.val() || {})
          .sort((a: any, b: any) => a.timestamp - b.timestamp) as Message[];
        
        // Use AI to extract structured data from the conversation
        const extractedData = await extractUserDataWithAI(allMsgs);
        
        if (extractedData && (extractedData.nombre_completo || extractedData.cedula || extractedData.numero_cuenta)) {
          console.log('[EXTRACT] Successfully extracted user data:', JSON.stringify(extractedData));
          
          // Check if case already exists - if so, update it; if not, create it
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
        
        // Clear the waiting flag
        await update(ref(db, 'chats/' + chatId), { waitingForData: false });
        // Fall through to normal AI processing to confirm the case
      }
      // Check if user says they'll send soon
      else if (isUserSayingWillSendSoon(content)) {
        console.log('[WAITING] User says will send soon, acknowledging briefly...');
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