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
    
    // Log the FULL incoming message structure
    console.log('[FULL_MSG]', JSON.stringify(msg));
    
    // Clean content - remove image markers
    const imageMarkers = ['[Imagen]', '[album]', '[album recibido]', '[Imagen received from user]', 'imagen received', 'album recibido', 'image'];
    let cleanContent = content;
    for (const marker of imageMarkers) {
      cleanContent = cleanContent.replace(new RegExp(marker, 'gi'), '').trim();
    }
    
    // Check if it's ONLY an image (no real text content after removing markers)
    const isOnlyImage = !cleanContent || cleanContent.length < 2;
    
    console.log('[DEBUG] phone:', phone, '| raw:', content, '| clean:', cleanContent, '| isOnlyImage:', isOnlyImage, '| msgType:', msgType);
    
    const chatId = phone.replace(/\D/g, '').slice(-10);
    const db = getFirebaseDB();
    const msgId = 'm_' + Date.now();
    
    // If ONLY image (no real text), save and EXIT silently
    if (isOnlyImage || msgType === 'image') {
      const msgData: Message = { id: msgId, chatId, content: content || '[Imagen]', sender: 'user', timestamp: Date.now(), status: 'delivered' };
      
      const chatSnap = await get(child(ref(db), 'chats/' + chatId));
      const oldChat = chatSnap.val() || {};
      
      await set(ref(db, 'messages/' + chatId + '/' + msgId), msgData);
      await update(ref(db, 'chats/' + chatId), { 
        lastMessage: content || '[Imagen]', 
        lastMessageTime: Date.now(),
        unreadCount: (oldChat.unreadCount || 0) + 1 
      });
      console.log('[IMAGE-ONLY] Guardada. Sonia calla.');
      return NextResponse.json({ success: true, action: 'image_only_silent' });
    }
    
    // Has REAL text - normal flow with AI
    const msgData: Message = { id: msgId, chatId, content, sender: 'user', timestamp: Date.now(), status: 'delivered' };
    
    const chatSnap = await get(child(ref(db), 'chats/' + chatId));
    const oldChat = chatSnap.val() || {};
    const aiEnabled = oldChat.aiEnabled !== false;
    
    await set(ref(db, 'messages/' + chatId + '/' + msgId), msgData);
    await update(ref(db, 'chats/' + chatId), { 
      lastMessage: content, 
      lastMessageTime: Date.now(),
      unreadCount: (oldChat.unreadCount || 0) + 1,
      aiEnabled 
    });
    
    // Get message history for AI context
    const histSnap = await get(child(ref(db), 'messages/' + chatId));
    const allMsgs = Object.values(histSnap.val() || {}).sort((a: any, b: any) => a.timestamp - b.timestamp) as Message[];
    const history = allMsgs.map(m => (m.sender === 'agent' ? 'A' : 'U') + ': ' + m.content).join('\n');
    
    // Auto-register case
    const allContent = history + '\n' + content;
    const isReembolso = history.toLowerCase().includes('reembolso') || content.toLowerCase().includes('reembolso');
    const hasBankData = /nombre|cedula|telefono|cuenta|corriente|ahorro/i.test(allContent) || /\d{5,9}/.test(allContent.replace(/\s/g, ''));
    const hasImages = /\[imagen|\[image|album|received/i.test(history) || /\[imagen|\[image|album|received/i.test(content);
    const hasCase = (await get(child(ref(db), 'casos_reembolso/' + chatId))).exists();
    
    if (!hasCase && isReembolso && hasBankData && hasImages) {
      const lines = allContent.split('\n').filter(Boolean);
      let nombre = 'Usuario', cedula = '', telefono = '', cuenta = '', tipo = 'Corriente';
      
      for (const line of lines) {
        const clean = line.replace(/\s/g, '');
        if (!nombre && /^[A-Z][a-z]+\s[A-Z][a-z]+/.test(line) && !line.includes('VOLTAJE')) nombre = line;
        if (!telefono && /0\d{10}/.test(clean)) { const m = clean.match(/0\d{10}/); if (m) telefono = m[0]; }
        if (!cuenta && clean.length >= 20) { const m = clean.match(/\d{20}/); if (m) cuenta = m[0].padStart(20, '0'); }
        if (!cedula && /\d{5,9}/.test(clean) && clean.length >= 5 && !clean.startsWith('0') && clean !== telefono && clean !== cuenta) { const m = clean.match(/\d{5,9}/); if (m) cedula = m[0]; }
        if (line.toLowerCase().includes('ahorro')) tipo = 'Ahorro';
        else if (line.toLowerCase().includes('visa')) tipo = 'Visa';
      }
      
      const caso = {
        caso_id: 'CASO-' + Date.now(),
        fecha_primer_contacto: new Date(Date.now() - 30*60000).toISOString(),
        fecha_registro_caso: new Date().toISOString(),
        canal: 'WhatsApp',
        agente: 'SONIA',
        datos_usuario: { nombre_completo: nombre, cedula, telefono, numero_cuenta: cuenta, tipo_cuenta: tipo },
        evidencias: { captura_historial_operaciones: 'Si', captura_billetera_app: 'Si', captura_movimientos_bancarios: 'Si' },
        estado_caso: 'pendiente_validacion'
      };
      await set(ref(db, 'casos_reembolso/' + chatId), caso);
    }
    
    // AI Response (only for text messages - SAFETY CHECK)
    if (aiEnabled && GOOGLE_API_KEY && WHAPI_TOKEN) {
      // FINAL CHECK: If content has image markers, skip AI completely
      const hasImageMarkers = /\[imagen\]|\[album\]|imagen received|album reci/i.test(content.toLowerCase());
      if (hasImageMarkers || isOnlyImage) {
        console.log('[SAFETY] Skipping AI - image detected in content');
        return NextResponse.json({ success: true, action: 'skipped_ai_image_detected' });
      }
      
      let prompt = 'Eres SONIA de VOLTAJE PLUS. FLUJO: Saludar (1 vez) "¡Hola! 👋 Soy Sonia.¿En qué te ayudo?". Si pide reembolso "Lamentamos🙏. Necesitamos: 1)📱Captura app 2)👛Captura billetera 3)🏦Captura banco + Tus datos". Si tiene todo "¡Perfecto! ✅ Caso registrado. Te contactaremos". REGLAS: 1.NO repeat 2.NO saludar dos veces 3.NO notas internas 4.UNA respuesta por turno';
      
      try {
        const pSnap = await get(child(ref(db), 'system/prompt'));
        if (pSnap.exists()) {
          const pd = pSnap.val();
          if (typeof pd === 'string' && pd.length > 10) prompt = pd;
          else if (pd && pd.value) prompt = pd.value;
        }
      } catch {}
      
      const recent = allMsgs.slice(-10).map(m => (m.sender === 'agent' ? 'A' : 'U') + ': ' + m.content).join('\n');
      const fullPrompt = prompt + '\n\n' + recent + '\n\nU: ' + content;
      
      try {
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
            await update(ref(db, 'chats/' + chatId), { lastMessage: reply, lastMessageTime: Date.now() });
            console.log('[SONIA] Respondió:', reply.substring(0, 50));
          }
        }
      } catch (e) { console.error(e); }
    }
    
    return NextResponse.json({ success: true });
  } catch (e) { console.error(e); return NextResponse.json({ error: 'Error' }, { status: 500 }); }
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode');
  const challenge = req.nextUrl.searchParams.get('hub.challenge');
  if (mode === 'subscribe') return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ ok: true });
}