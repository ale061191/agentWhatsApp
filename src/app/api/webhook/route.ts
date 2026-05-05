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

    // WHAPI documentation format
    if (body.messages && Array.isArray(body.messages)) {
      messages = body.messages;
      const msg = messages[0];
      
      // Ignore messages from ourselves (the bot)
      if (msg.from_me === true) {
        console.log('Ignoring message sent by the bot');
        return NextResponse.json({ success: true, ignored: true });
      }

      phone = msg.chat_id?.replace('@s.whatsapp.net', '') || msg.from || '';
      messageContent = msg.text?.body || '';

      if (!messageContent && msg.type !== 'text') {
         console.log(`Skipping non-text message of type: ${msg.type}`);
         return NextResponse.json({ success: true, skipped: 'non-text' });
      }
    } 
    // Fallback format
    else {
       console.log('Unsupported payload structure');
       return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
    }

    if (!phone || !messageContent) {
      console.log('Missing phone or content in payload');
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
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
        // We fetch the history for context
        const historySnap = await get(child(dbRef, `messages/${chatId}`));
        const messagesObj = historySnap.val() || {};
        const chatMessages = Object.values(messagesObj).sort((a: any, b: any) => a.timestamp - b.timestamp) as Message[];
        
        const historyText = chatMessages
          .slice(-10)
          .map((m: Message) => `${m.sender === 'agent' ? 'Agente' : 'Cliente'}: ${m.content}`)
          .join('\n');

        const prompt = `Eres un asistente de atención al cliente profesional, amigable y eficiente de NOVA TECH AI. 
Responde de manera profesional, breve y útil en máximo 2 párrafos.

Historial:
${historyText}

Nuevo mensaje: ${messageContent}`;

        const aiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 500,
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