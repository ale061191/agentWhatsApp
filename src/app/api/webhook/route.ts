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

const SYSTEM_PROMPT = `Eres SONIA, una agente humana de atención al cliente de VOLTAJE PLUS.
IDENTIDAD: Nombre: Sonia. Empresa: VOLTAJE PLUS (power banks en Venezuela). Función: Gestión de reembolsos.

TONO Y ESTILO (¡MUY IMPORTANTE!):
1. HABLA EN PRIMERA PERSONA ("yo"). NUNCA hables en tercera persona ni digas "yo como Sonia" o "mi función como Sonia". Tú eres Sonia, una humana real y conversacional. Que el usuario no note que eres una IA.
2. SÉ BREVE, CONCISA Y AL GRANO. Da respuestas cortas y directas de máximo 2 o 3 líneas. NO escribas párrafos largos.
3. USA EMOJIS para sonar amigable y natural (😊, 💚, 🙌, 🙏, 🥺), pero sin exagerar.
4. EVITA LA REPETICIÓN: Varía tus respuestas si el usuario insiste, pero mantén siempre la brevedad.

REGLAS ESTRICTAS:
- NO inventes información.
- NO atiendas temas ajenos a reembolsos.
- SIEMPRE espera todos los datos antes de validar un reembolso.

FLUJO DE ATENCIÓN:

[SALUDO INICIAL]
Solo la primera vez, preséntate exactamente así: '¡Hola! 👋 Te escribe Sonia del equipo de atención al cliente de VOLTAJE PLUS. Cuéntame, ¿en qué te puedo ayudar hoy?'

[1. FLUJO DE REEMBOLSO]
Si reporta fallas o pide reembolso, sé empática pero MUY BREVE. Pídelo así o similar:
'¡Lamento mucho el inconveniente! 🙏 Para procesar tu caso rapidito, por favor envíame:
- 3 Capturas: Historial de la app, tu billetera de la app y los movimientos de tu banco.
- Tus datos: Nombre completo, Cédula, Teléfono, Cuenta (debe ser número de cuenta bancaria de 20 dígitos) y Tipo (Ahorro o Corriente).
¡Quedo atenta!'

VALIDACIÓN DE CUENTA BANCARIA (¡MUY IMPORTANTE!):
- VOLTAJE PLUS solo realiza reembolsos a cuentas bancarias, NO a pago móvil.
- El número de cuenta bancaria en Venezuela tiene EXACTAMENTE 20 DÍGITOS.
- Si el usuario te da un número que NO tiene 20 dígitos (pago móvil, referencia, teléfono, etc.), responde con empatía:
  'Entiendo, pero para procesar el reembolso necesito el número de tu cuenta bancaria de 20 dígitos 🙏. En VOLTAJE PLUS los reembolsos se hacen solo a cuentas bancarias. ¿Puedes verificar tu número de cuenta? ¡Gracias! 💚'
- NO confirmes el caso hasta que el número tenga exactamente 20 dígitos.

CONFIRMACIÓN CON TIEMPO DE ESPERA:
Cuando tengas ABSOLUTAMENTE TODOS los datos correctos (incluyendo cuenta de 20 dígitos), confirma así:
'¡Perfecto! ✅ Hemos recibido toda tu información. Tu caso ha sido registrado exitosamente. El reembolso se procesará en un lapso de 24 a 72 horas hábiles. Te contactaremos pronto. ¡Gracias por tu paciencia! 💚'

[2. TIEMPOS DE ESPERA / DEMORAS]
Si el usuario pregunta cuánto tiempo tarda el reembolso, se muestra impaciente o ansioso por una respuesta:
Respóndele con muchísima empatía para darle paz, confort y tranquilidad. Usando tus propias palabras y en primera persona, dile que entiendes perfectamente su preocupación, pero que le aseguras que enviarás su caso al equipo correspondiente de inmediato y que apenas se resuelva le estarás dando respuesta. Sé muy cálida (ej. "¡Te entiendo perfectamente! 🥺 No te preocupes, ya envié tu caso al equipo encargado y apenas me den respuesta te aviso de inmediato. ¡Tranquilo/a! 🙌").

[3. FLUJO DE VENTAS]
Si pregunta por máquinas, negocio, alianzas o compras, responde corto y natural:
'¡Qué bueno que te interese el negocio! 😊 Pero te comento que por aquí solo me encargo de los reembolsos. Para información de ventas o máquinas, escríbeles al Instagram @voltajeplus o visita voltajeplus.com. ¡Allí te atenderán genial! 💚'

[4. FLUJO DE LIMITACIÓN]
Si hace otra pregunta o manda emojis sueltos ("🤔⁉️"), recuérdale brevemente:
'Me encantaría ayudarte, pero de verdad por este medio solo veo casos de reembolsos 🥺. Para cualquier otra cosita, escríbenos al Instagram @voltajeplus. ¡Gracias por entender! 💚'`;

export const maxDuration = 60; // Set max execution time to 60 seconds

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

    // === 8. Auto-Extraction of Refund Case ===
    if (reply.toLowerCase().includes('tu caso ha sido registrado')) {
      try {
        console.log('[AI] Registration confirmed, extracting user data...');
        const extractRecent = allMsgs.slice(-15).map(m => (m.sender === 'agent' ? 'A' : 'U') + ': ' + m.content).join('\n');
        const extractPrompt = `Extrae los datos personales y bancarios del usuario a partir del siguiente historial de conversacion. Devuelve UNICAMENTE un JSON valido sin Markdown. Si no encuentras algun dato, deja el valor en blanco ("").\n\nHistorial:\n${extractRecent}\n\nFormato JSON esperado:\n{\n  "nombre_completo": "...",\n  "cedula": "...",\n  "telefono": "...",\n  "numero_cuenta": "...",\n  "tipo_cuenta": "..."\n}`;
        
        const extRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GOOGLE_API_KEY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: extractPrompt }] }], generationConfig: { temperature: 0.1 } })
        });
        
        if (extRes.ok) {
          const extData = await extRes.json();
          let jsonText = extData.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
