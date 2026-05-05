import { NextRequest, NextResponse } from 'next/server';
import { useStore } from '@/store/useStore';
import { Message } from '@/types';

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

async function saveMessageToDB(chatId: string, message: Message) {
  try {
    await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveMessage',
        chatId,
        message,
        chat: { unreadCount: 1 },
      }),
    });
  } catch (e) {
    console.error('Error saving to DB:', e);
  }
}

async function saveChatToDB(chat: { id: string; phone: string; name: string; lastMessage: string; lastMessageTime: number; unreadCount: number; aiEnabled: boolean }) {
  try {
    await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveChat',
        chat,
      }),
    });
  } catch (e) {
    console.error('Error saving chat to DB:', e);
  }
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

    const store = useStore.getState();
    let aiEnabled = true;
    
    // Check if chat exists and get AI status
    const existingChat = store.chats.find(c => c.id === chatId);
    if (existingChat) {
      aiEnabled = existingChat.aiEnabled;
    } else {
      // Create new chat
      const newChat = {
        id: chatId,
        phone: phone,
        name: messages[0]?.from_name || '',
        lastMessage: messageContent,
        lastMessageTime: Date.now(),
        unreadCount: 1,
        aiEnabled: true,
      };
      
      store.setChats([...store.chats, newChat as any]);
      await saveChatToDB(newChat);
      console.log('Created new chat:', chatId);
    }
    
    // Save the incoming message
    store.addMessage(chatId, message);
    await saveMessageToDB(chatId, message);
    
    // Trigger AI response if enabled
    if (aiEnabled && GOOGLE_API_KEY && WHAPI_TOKEN && shouldRespond()) {
      messageCount.count++;
      const delay = getRandomDelay();
      console.log(`AI enabled, scheduling response in ${Math.round(delay/1000)}s`);
      
      setTimeout(async () => {
        try {
          const chatMessages = store.messages[chatId] || [];
          
          const historyText = chatMessages
            .slice(-10)
            .map((m: Message) => `${m.sender === 'agent' ? 'Agente' : 'Cliente'}: ${m.content}`)
            .join('\n');

          const prompt = `Eres un asistente de atención al cliente profesional, amigable y eficiente de NOVA TECH AI. 
Responde de manera profesional, breve y útil en máximo 2 párrafos.

Historial:
${historyText}

Nuevo mensaje: ${messageContent}`;

          console.log('Calling Gemini API...');

          const aiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
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
             console.error('Gemini API Error:', await aiResponse.text());
             return;
          }

          const aiData = await aiResponse.json();
          const aiText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

          if (aiText) {
            console.log('Sending AI response via WHAPI...');
            
            const whapiRes = await fetch(`${WHAPI_BASE_URL}/sendMessage`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${WHAPI_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: phone, // using the full phone/chat_id
                text: { body: aiText },
              }),
            });

            if (!whapiRes.ok) {
               console.error('WHAPI Send Error:', await whapiRes.text());
               return;
            }

            const aiMsg: Message = {
              id: `ai_${Date.now()}`,
              chatId,
              content: aiText,
              sender: 'agent',
              timestamp: Date.now(),
              status: 'sent',
            };
            store.addMessage(chatId, aiMsg);
            await saveMessageToDB(chatId, aiMsg);
            console.log('AI response sent and saved');
          }
        } catch (e) {
          console.error('AI Processing Error:', e);
        }
      }, delay);
    } else {
       console.log(`Not responding. aiEnabled:${aiEnabled}, hasApiKey:${!!GOOGLE_API_KEY}, hasWhapiToken:${!!WHAPI_TOKEN}`);
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