import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseDB } from '@/lib/firebase';
import { ref, set, get, push, update, child } from 'firebase/database';

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get('action');
    const chatId = request.nextUrl.searchParams.get('chatId');
    const db = getFirebaseDB();
    const dbRef = ref(db);

    if (action === 'getSystemPrompt') {
      const snapshot = await get(child(dbRef, 'system/prompt'));
      if (snapshot.exists()) {
        let promptData = snapshot.val();
        if (typeof promptData === 'string') {
          return NextResponse.json({ prompt: promptData });
        } else if (promptData && typeof promptData.value === 'string') {
          return NextResponse.json({ prompt: promptData.value });
        } else if (promptData && typeof promptData.prompt === 'string') {
          return NextResponse.json({ prompt: promptData.prompt });
        }
        return NextResponse.json({ prompt: null });
      }
      return NextResponse.json({ prompt: null });
    }

    if (action === 'getCasosReembolso') {
      const snapshot = await get(child(dbRef, 'casos_reembolso'));
      if (snapshot.exists()) {
        return NextResponse.json({ casos: snapshot.val() });
      }
      return NextResponse.json({ casos: null });
    }

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

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Firebase error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, chatId, message, chat, chats, prompt, caso } = body;

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

    if (action === 'deleteChat') {
      if (!chatId) {
        return NextResponse.json({ error: 'Missing chatId' }, { status: 400 });
      }

      // Delete chat and its messages
      await set(ref(db, `chats/${chatId}`), null);
      await set(ref(db, `messages/${chatId}`), null);

      return NextResponse.json({ success: true });
    }

    if (action === 'clearUnreadCount') {
      if (!chatId) {
        return NextResponse.json({ error: 'Missing chatId' }, { status: 400 });
      }

      await update(ref(db, `chats/${chatId}`), { unreadCount: 0 });

      return NextResponse.json({ success: true });
    }

    if (action === 'saveSystemPrompt') {
      if (!prompt) {
        return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
      }

      const promptRef = ref(db, 'system/prompt');
      await set(promptRef, prompt);

      return NextResponse.json({ success: true });
    }

    if (action === 'saveCasoReembolso') {
      if (!caso) {
        return NextResponse.json({ error: 'Missing caso data' }, { status: 400 });
      }

      const casosRef = ref(db, 'casos_reembolso');
      const newCasoRef = push(casosRef);
      await set(newCasoRef, caso);

      return NextResponse.json({ success: true, casoId: newCasoRef.key });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Firebase error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}