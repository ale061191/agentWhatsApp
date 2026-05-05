import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseDB } from '@/lib/firebase';
import { ref, set, get, push, onValue, update } from 'firebase/database';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, chatId, message, chat, chats } = body;

    if (!action) {
      return NextResponse.json({ error: 'Missing action' }, { status: 400 });
    }

    const db = getFirebaseDB();

    if (action === 'saveMessage') {
      if (!chatId || !message) {
        return NextResponse.json({ error: 'Missing chatId or message' }, { status: 400 });
      }

      const messagesRef = ref(db, `chats/${chatId}/messages`);
      const newMessageRef = push(messagesRef);
      await set(newMessageRef, message);

      const chatRef = ref(db, `chats/${chatId}`);
      await update(chatRef, {
        lastMessage: message.content,
        lastMessageTime: message.timestamp,
        unreadCount: (chat?.unreadCount || 0) + 1,
      });

      return NextResponse.json({ success: true, id: newMessageRef.key });
    }

    if (action === 'saveChat') {
      if (!chat || !chat.id) {
        return NextResponse.json({ error: 'Missing chat data' }, { status: 400 });
      }

      const chatRef = ref(db, `chats/${chat.id}`);
      await set(chatRef, chat);

      return NextResponse.json({ success: true });
    }

    if (action === 'saveAllChats') {
      if (!chats || !Array.isArray(chats)) {
        return NextResponse.json({ error: 'Missing chats array' }, { status: 400 });
      }

      for (const c of chats) {
        const chatRef = ref(db, `chats/${c.id}`);
        await set(chatRef, c);
      }

      return NextResponse.json({ success: true });
    }

    if (action === 'updateChatAiStatus') {
      if (!chatId || typeof chat?.aiEnabled !== 'boolean') {
        return NextResponse.json({ error: 'Missing chatId or aiEnabled' }, { status: 400 });
      }

      const chatRef = ref(db, `chats/${chatId}`);
      await update(chatRef, { aiEnabled: chat.aiEnabled });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Firebase error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get('action');
    const chatId = request.nextUrl.searchParams.get('chatId');

    const db = getFirebaseDB();

    if (action === 'getChats') {
      const chatsRef = ref(db, 'chats');
      const snapshot = await get(chatsRef);
      
      if (!snapshot.exists()) {
        return NextResponse.json({ chats: {} });
      }

      const chatsData = snapshot.val();
      return NextResponse.json({ chats: chatsData });
    }

    if (action === 'getMessages' && chatId) {
      const messagesRef = ref(db, `chats/${chatId}/messages`);
      const snapshot = await get(messagesRef);
      
      if (!snapshot.exists()) {
        return NextResponse.json({ messages: [] });
      }

      const messagesData = snapshot.val();
      const messages = Object.entries(messagesData).map(([key, value]) => ({
        id: key,
        ...(value as object),
      }));

      return NextResponse.json({ messages });
    }

    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  } catch (error) {
    console.error('Firebase error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}