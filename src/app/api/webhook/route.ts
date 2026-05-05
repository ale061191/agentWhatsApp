import { NextRequest, NextResponse } from 'next/server';
import { Message } from '@/types';
import { getFirebaseDB } from '@/lib/firebase';
import { ref, set, get, child, update } from 'firebase/database';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

const MIN_DELAY_MS = 30000;
const MAX_DELAY_MS = 60000;
const MAX_MESSAGES_PER_DAY = 100;

const messageCount = { count: 0, lastReset: Date.now() };

function shouldRespond(): boolean {
  const now = Date.now();
  if (now - messageCount.lastReset > 24 * 60 * 60 * 1000) {
    messageCount.count = 0;
    messageCount.lastReset = now;
  }
  return messageCount.count < MAX_MESSAGES_PER_DAY;
}

function getRandomDelay(): number {
  return Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS) + MIN_DELAY_MS;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('Webhook raw body:', JSON.stringify(body, null, 2).slice(0, 1000));
    
    let messages: any[] = [];
    let phone = '';
    let messageContent = '';
    let lastMsgType = 'unknown';

    // WHAPI documentation format
if (body.messages && Array.isArray(body.messages)) {
      messages = body.messages;
      const msg = messages[0];
      
      console.log('Full message payload:', JSON.stringify(msg).slice(0, 500)); // Log for debugging
      
      // Ignore messages from ourselves (the bot)
      if (msg.from_me === true) {
        console.log('Ignoring message sent by the bot');
        return NextResponse.json({ success: true, ignored: true });
      }

phone = msg.chat_id?.replace('@s.whatsapp.net', '') || msg.from || '';
      
      // Handle different message types - get any text content
      let msgType = msg.type || 'unknown';
      messageContent = msg.text?.body || '';
      
      // If there's an image, note it (even without caption)
      // Also check for image_waits or media types
      if (msgType === 'image' || msgType === 'image_waits' || msg.media?.type === 'image') {
        messageContent = messageContent || `[Imagen received from user]`;
        console.log('Image detected, type:', msgType);
      }
      // If it's a different type, mark it
      if (msgType && msgType !== 'text' && !messageContent) {
         messageContent = `[${msgType} recibido]`;
      }
    } else {
       console.log('Unsupported payload structure');
       return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
    }

    if (!phone) {
      console.log('Missing phone in payload');
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
    }

    // If no text content, skip empty messages
    if (!messageContent) {
       console.log(`Skipping empty message of type: ${lastMsgType}`);
       return NextResponse.json({ success: true, skipped: 'empty' });
    }

    const chatId = phone.replace(/\D/g, '').slice(-10);
    console.log(`Processing incoming message from ${phone} (chatId: ${chatId})`);

    const message: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      chatId,
      content: messageContent,
      sender: 'user',
      timestamp: Date.now(),
      status: 'delivered',
    };

    // Initialize Firebase
    const db = getFirebaseDB();
    const dbRef = ref(db);
    
    // Check if chat exists
    const chatSnapshot = await get(child(dbRef, `chats/${chatId}`));
    let chatData = chatSnapshot.val();
    let aiEnabled = true;

    if (chatData) {
      aiEnabled = chatData.aiEnabled !== false; // default true if not set
      // Update existing chat
      await update(ref(db, `chats/${chatId}`), {
        lastMessage: messageContent,
        lastMessageTime: Date.now(),
        unreadCount: (chatData.unreadCount || 0) + 1
      });
    } else {
      // Create new chat
      chatData = {
        id: chatId,
        phone: phone,
        name: messages[0]?.from_name || phone,
        lastMessage: messageContent,
        lastMessageTime: Date.now(),
        unreadCount: 1,
        aiEnabled: true,
      };
      await set(ref(db, `chats/${chatId}`), chatData);
      console.log('Created new chat:', chatId);
    }
    
    // Save the incoming message
    await set(ref(db, `messages/${chatId}/${message.id}`), message);
    console.log('Message saved to DB');
    
    // Trigger AI response if enabled
    if (aiEnabled && GOOGLE_API_KEY && WHAPI_TOKEN && shouldRespond()) {
      messageCount.count++;
      
      // FIRE AND FORGET - Don't wait for setTimeout in serverless, do it immediately but don't block
      // Vercel serverless functions die when the response is sent. We must do the API calls BEFORE returning.
      
      try {
        console.log('Calling Gemini API directly...');
        
        // Fetch system prompt from Firebase or use default
        let systemPrompt = `Eres un asistente de atención al cliente profesional, amigable y eficiente de NOVA TECH AI. 
Responde de manera profesional, breve y útil en máximo 2 párrafos.`;
        
        try {
          const promptSnap = await get(child(dbRef, 'system/prompt'));
          if (promptSnap.exists() && promptSnap.val()) {
            systemPrompt = promptSnap.val();
            console.log('Loaded custom system prompt from DB');
          }
        } catch (e) {
          console.log('Using default prompt');
        }
        
        // We fetch the history for context
        const historySnap = await get(child(dbRef, `messages/${chatId}`));
        const messagesObj = historySnap.val() || {};
        const chatMessages = Object.values(messagesObj).sort((a: any, b: any) => a.timestamp - b.timestamp) as Message[];
        
        const historyText = chatMessages
          .slice(-10)
          .map((m: Message) => `${m.sender === 'agent' ? 'Agente' : 'Cliente'}: ${m.content}`)
          .join('\n');

        // Check if user confirmed sending all requirements for reembolso case
        // Auto-register case when user confirms AND we haven't registered one yet
        let userConfirm = messageContent.toLowerCase();
        let looksLikeReembolso = historyText.toLowerCase().includes('reembolso') || historyText.toLowerCase().includes('volTAJE');
        let hasBankData = historyText.match(/nombre|cedula|telefono|cuenta|corriente|ahorro/i);
        let hasImages = historyText.toLowerCase().includes('[imagen') || historyText.toLowerCase().includes('[image') || historyText.toLowerCase().includes('captura');
        let alreadyHasCaso = (await get(child(dbRef, `casos_reembolso/${chatId}`))).exists();
        
        if (!alreadyHasCaso && looksLikeReembolso && hasBankData && hasImages && 
            (userConfirm.includes('ya') || userConfirm.includes('tienes') || userConfirm.includes('toda') || userConfirm.includes('completo') || userConfirm.includes('enviado') || userConfirm.includes('toda la info'))) {
          
          console.log('Auto-registering reembolso case from user confirmation');
          
          // Extract user data from context
          let allContent = historyText + '\n' + messageContent;
          let cedulaMatch = allContent.match(/(\d{6,8})/);
          let telefonoMatch = allContent.match(/0(414|416|424|426|412|4\d{2})\d{7}/);
          let cuentaMatch = allContent.match(/01\d{19}/);
          let nombreMatch = allContent.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)/);
          
          const casoData = {
            caso_id: chatId,
            fecha_primer_contacto: new Date(Date.now() - 30*60000).toISOString(),
            fecha_registro_caso: new Date().toISOString(),
            canal: 'WhatsApp',
            agente: 'SONIA — VOLTAJE PLUS',
            datos_usuario: {
              nombre_completo: nombreMatch ? nombreMatch[1] : 'Usuario',
              cedula: cedulaMatch ? cedulaMatch[1] : '',
              telefono: telefonoMatch ? telefonoMatch[0] : '',
              numero_cuenta: cuentaMatch ? cuentaMatch[0] : '',
              tipo_cuenta: allContent.toLowerCase().includes('corriente') ? 'Corriente' : 'Ahorro'
            },
            evidencias: {
              captura_historial_operaciones: '[Imagen recibida]',
              captura_billetera_app: '[Imagen recibida]',
              captura_movimientos_bancarios: '[Imagen recibida]'
            },
            estado_caso: 'pendiente_validacion'
          };
          
          try {
            await set(ref(db, `casos_reembolso/${chatId}`), casoData);
            console.log('Caso de reembolso auto-registrado:', chatId);
          } catch (e) {
            console.error('Error auto-registrando caso:', e);
          }
        }

        const prompt = `${systemPrompt}

Historial:
${historyText}

Nuevo mensaje: ${messageContent}`;

        const aiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.7,
              },
            }),
          }
        );

        if (!aiResponse.ok) {
           const errText = await aiResponse.text();
           console.error('Gemini API Error:', errText);
           await set(ref(db, `messages/${chatId}/err_${Date.now()}`), {
             id: `err_${Date.now()}`, chatId, content: `Error en IA (Gemini): ${errText}`, sender: 'agent', timestamp: Date.now(), status: 'sent'
           });
        } else {
          const aiData = await aiResponse.json();
          const aiText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

          if (aiText) {
            console.log('Sending AI response via WHAPI...');
            
            const whapiRes = await fetch(`${WHAPI_BASE_URL}/messages/text`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${WHAPI_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify({
                to: phone, // using the full phone/chat_id
                body: aiText,
              }),
            });

            if (!whapiRes.ok) {
               const errText = await whapiRes.text();
               console.error('WHAPI Send Error:', errText);
               await set(ref(db, `messages/${chatId}/err_${Date.now()}`), {
                 id: `err_${Date.now()}`, chatId, content: `Error al enviar WHAPI: ${errText}`, sender: 'agent', timestamp: Date.now(), status: 'sent'
               });
            } else {
              const aiMsg: Message = {
                id: `ai_${Date.now()}`,
                chatId,
                content: aiText,
                sender: 'agent',
                timestamp: Date.now(),
                status: 'sent',
              };
              
              // Save AI message to DB
              await set(ref(db, `messages/${chatId}/${aiMsg.id}`), aiMsg);
              await update(ref(db, `chats/${chatId}`), {
                lastMessage: aiText,
                lastMessageTime: Date.now()
              });
              console.log('AI response sent and saved');
            }
          }
        }
      } catch (e: any) {
        console.error('AI Processing Error:', e);
        await set(ref(db, `messages/${chatId}/err_${Date.now()}`), {
           id: `err_${Date.now()}`, chatId, content: `Error interno procesando IA: ${e.message}`, sender: 'agent', timestamp: Date.now(), status: 'sent'
        });
      }
    } else {
       const reason = `No respondo. aiEnabled:${aiEnabled}, GOOGLE_API_KEY:${!!GOOGLE_API_KEY}, WHAPI_TOKEN:${!!WHAPI_TOKEN}`;
       console.log(reason);
       if (!GOOGLE_API_KEY || !WHAPI_TOKEN) {
         await set(ref(db, `messages/${chatId}/err_${Date.now()}`), {
            id: `err_${Date.now()}`, chatId, content: `Error de configuración: Faltan variables de entorno. ${reason}`, sender: 'agent', timestamp: Date.now(), status: 'sent'
         });
       }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');

  if (mode === 'subscribe') {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ status: 'ok', message: 'NOVA TECH AI webhook' });
}