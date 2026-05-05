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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    console.log('Webhook raw body:', JSON.stringify(body, null, 2));
    
    let messages: any[] = [];
    let phone = '';

    if (body.messages) {
      messages = body.messages;
      phone = body.phone || body.from || '';
    } else if (body.entry && body.entry[0]?.changes) {
      const changes = body.entry[0].changes[0];
      if (changes.value?.messages) {
        messages = changes.value.messages;
        phone = changes.value.metadata?.phone_number_id || '';
      }
    } else if (Array.isArray(body)) {
      messages = body;
      phone = body[0]?.from || '';
    }

    if (!messages || messages.length === 0 || !phone) {
      console.log('No messages found. Full body:', JSON.stringify(body));
      return NextResponse.json(
        { error: 'No valid messages found', received: body },
        { status: 400 }
      );
    }

    const chatId = phone.replace(/\D/g, '').slice(-10);
    console.log('Processing from phone:', phone, 'chatId:', chatId);

    for (const msg of messages) {
      if (msg.type === 'text' || msg.text) {
        const messageContent = msg.text?.body || msg.body || msg.message || '';
        
        if (!messageContent) continue;

        const message: Message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          chatId,
          content: messageContent,
          sender: 'user',
          timestamp: msg.timestamp ? msg.timestamp * 1000 : Date.now(),
          status: 'delivered',
        };

        console.log('Received message:', messageContent);

        const store = useStore.getState();
        
        let aiEnabled = false;
        const existingChat = store.chats.find(c => c.id === chatId);
        if (existingChat) {
          aiEnabled = existingChat.aiEnabled;
        }

        if (!existingChat) {
          store.setChats([
            ...store.chats,
            {
              id: chatId,
              phone: phone,
              name: '',
              lastMessage: messageContent,
              lastMessageTime: message.timestamp,
              unreadCount: 1,
              aiEnabled: true,
            }
          ]);
          console.log('Created new chat for:', chatId);
        }
        
        store.addMessage(chatId, message);
        console.log('Added message to store');

        if (aiEnabled && GOOGLE_API_KEY && WHAPI_TOKEN && shouldRespond()) {
          messageCount.count++;
          
          const chatMessages = store.messages[chatId] || [];
          const delay = getRandomDelay();
          
          console.log('Scheduling AI response in', delay, 'ms');
          
          setTimeout(async () => {
            try {
              const historyText = chatMessages
                ?.slice(-10)
                ?.map((m: Message) => 
                  `${m.sender === 'agent' ? 'Agente' : 'Cliente'}: ${m.content}`
                )
                ?.join('\n') || '';

              const prompt = `Eres un asistente de atención al cliente profesional, amigable y eficiente. 
              Responde de manera profesional, breve y útil en máximo 2 párrafos.
              
              Historial de la conversación:
              ${historyText}
              
              Nuevo mensaje del cliente: ${messageContent}`;

              console.log('Calling Gemini AI...');

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

              const aiData = await aiResponse.json();
              console.log('Gemini response:', JSON.stringify(aiData));
              
              const aiText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

              if (aiText) {
                console.log('Sending AI response to:', phone);
                
                await fetch(`${WHAPI_BASE_URL}/sendMessage`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${WHAPI_TOKEN}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: phone,
                    text: { body: aiText },
                  }),
                });

                const aiMsg: Message = {
                  id: `ai_${Date.now()}`,
                  chatId,
                  content: aiText,
                  sender: 'agent',
                  timestamp: Date.now(),
                  status: 'sent',
                };
                store.addMessage(chatId, aiMsg);
                console.log('AI response sent and saved');
              }
            } catch (e) {
              console.error('Error sending AI response:', e);
            }
          }, delay);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');

  if (mode === 'subscribe') {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Invalid verification' }, { status: 403 });
}