import { NextRequest, NextResponse } from 'next/server';
import { useStore } from '@/store/useStore';
import { Message } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const { messages, phone } = body;

    if (!messages || !phone) {
      return NextResponse.json(
        { error: 'Invalid payload' },
        { status: 400 }
      );
    }

    const chatId = phone.replace(/\D/g, '').slice(-10);

    for (const msg of messages) {
      if (msg.type === 'text') {
        const message: Message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          chatId,
          content: msg.text?.body || '',
          sender: 'user',
          timestamp: msg.timestamp * 1000 || Date.now(),
          status: 'delivered',
        };

        const store = useStore.getState();
        
        const existingChat = store.chats.find(c => c.id === chatId);
        if (!existingChat) {
          store.setChats([
            ...store.chats,
            {
              id: chatId,
              phone: phone,
              name: '',
              lastMessage: message.content,
              lastMessageTime: message.timestamp,
              unreadCount: 1,
              aiEnabled: true,
            }
          ]);
        }
        
        store.addMessage(chatId, message);
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
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Invalid verification' }, { status: 403 });
}