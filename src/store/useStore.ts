import { create } from 'zustand';
import { AppState, Chat, Message } from '@/types';
import { getFirebaseDB } from '@/lib/firebase';
import { ref, onValue, set as setFirebase, update as updateFirebase } from 'firebase/database';

export const useStore = create<AppState & { subscribeToDB: () => void }>((set, get) => ({
  chats: [],
  messages: {},
  selectedChatId: null,
  isLoading: true,

  setLoading: (loading: boolean) => set({ isLoading: loading }),

  setChats: (chats: Chat[]) => set({ chats }),

  setSelectedChat: (chatId: string | null) => {
    set({ selectedChatId: chatId });
    if (chatId) {
      const db = getFirebaseDB();
      updateFirebase(ref(db, `chats/${chatId}`), { unreadCount: 0 }).catch(console.error);
    }
  },

  addMessage: (chatId: string, message: Message) => set((state) => {
    // This is primarily for local optimistic UI updates when sending messages manually
    const db = getFirebaseDB();
    setFirebase(ref(db, `messages/${chatId}/${message.id}`), message).catch(console.error);
    
    // Also update last message in chat optimistically
    updateFirebase(ref(db, `chats/${chatId}`), {
      lastMessage: message.content,
      lastMessageTime: message.timestamp,
    }).catch(console.error);
    
    return state; // The actual state update will come from the Firebase listener
  }),

  updateChatAiStatus: (chatId: string, enabled: boolean) => {
    const db = getFirebaseDB();
    updateFirebase(ref(db, `chats/${chatId}`), { aiEnabled: enabled }).catch(console.error);
    // State will update via listener
  },

  setChatName: (chatId: string, name: string) => {
    const db = getFirebaseDB();
    updateFirebase(ref(db, `chats/${chatId}`), { name }).catch(console.error);
  },

  loadFromDB: async () => {
    // No-op, kept for backwards compatibility in components, 
    // real loading happens in subscribeToDB
  },

  subscribeToDB: () => {
    const db = getFirebaseDB();
    
    // Listen to all chats
    onValue(ref(db, 'chats'), (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const chatsArray: Chat[] = Object.entries(data).map(([id, chatData]: [string, any]) => ({
          id,
          phone: chatData.phone || id,
          name: chatData.name || '',
          lastMessage: chatData.lastMessage || '',
          lastMessageTime: chatData.lastMessageTime || Date.now(),
          unreadCount: chatData.unreadCount || 0,
          aiEnabled: chatData.aiEnabled !== false,
        }));
        
        chatsArray.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
        set({ chats: chatsArray, isLoading: false });
      } else {
        set({ chats: [], isLoading: false });
      }
    });

    // Listen to all messages
    onValue(ref(db, 'messages'), (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const parsedMessages: Record<string, Message[]> = {};
        for (const [chatId, msgs] of Object.entries(data)) {
          parsedMessages[chatId] = Object.values(msgs as any).sort(
            (a: any, b: any) => a.timestamp - b.timestamp
          ) as Message[];
        }
        set({ messages: parsedMessages });
      } else {
        set({ messages: {} });
      }
    });
  },

  updateChat: (chatId: string, updates: Partial<Chat>) => {
    const db = getFirebaseDB();
    updateFirebase(ref(db, `chats/${chatId}`), updates).catch(console.error);
  },
}));