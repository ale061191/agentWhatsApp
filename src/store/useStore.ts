import { create } from 'zustand';
import { AppState, Chat, Message } from '@/types';

export const useStore = create<AppState>((set, get) => ({
  chats: [],
  messages: {},
  selectedChatId: null,
  isLoading: true,

  setLoading: (loading: boolean) => set({ isLoading: loading }),

  setChats: (chats: Chat[]) => set({ chats }),

  setSelectedChat: (chatId: string | null) => {
    set({ selectedChatId: chatId });
    if (chatId) {
      const { chats, updateChat } = get();
      const chat = chats.find(c => c.id === chatId);
      if (chat) {
        updateChat(chatId, { unreadCount: 0 });
      }
    }
  },

  addMessage: (chatId: string, message: Message) => set((state) => {
    const chatMessages = state.messages[chatId] || [];
    const updatedMessages = { ...state.messages, [chatId]: [...chatMessages, message] };

    const updatedChats = state.chats.map((chat) => {
      if (chat.id === chatId) {
        return {
          ...chat,
          lastMessage: message.content,
          lastMessageTime: message.timestamp,
          unreadCount: message.sender === 'user' && state.selectedChatId !== chatId
            ? chat.unreadCount + 1
            : chat.unreadCount,
        };
      }
      return chat;
    });

    fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveMessage',
        chatId,
        message,
        chat: {},
      }),
    }).catch(console.error);

    return { messages: updatedMessages, chats: updatedChats };
  }),

  updateChatAiStatus: (chatId: string, enabled: boolean) => {
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId ? { ...chat, aiEnabled: enabled } : chat
      ),
    }));

    fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateChatAiStatus',
        chatId,
        chat: { aiEnabled: enabled },
      }),
    }).catch(console.error);
  },

  setChatName: (chatId: string, name: string) => set((state) => ({
    chats: state.chats.map((chat) =>
      chat.id === chatId ? { ...chat, name } : chat
    ),
  })),

  loadFromDB: async () => {
    try {
      set({ isLoading: true });
      
      const response = await fetch('/api/db?action=getChats');
      const { chats: dbChats } = await response.json();

      if (dbChats) {
        const chatsArray: Chat[] = Object.entries(dbChats).map(([id, data]: [string, any]) => ({
          id,
          phone: data.phone || id,
          name: data.name || '',
          lastMessage: data.lastMessage || '',
          lastMessageTime: data.lastMessageTime || Date.now(),
          unreadCount: data.unreadCount || 0,
          aiEnabled: data.aiEnabled !== false,
        }));

        chatsArray.sort((a, b) => b.lastMessageTime - a.lastMessageTime);

        const messages: Record<string, Message[]> = {};
        
        for (const chat of chatsArray) {
          const msgResponse = await fetch(`/api/db?action=getMessages&chatId=${chat.id}`);
          const { messages: msgs } = await msgResponse.json();
          if (msgs && msgs.length > 0) {
            messages[chat.id] = msgs.sort((a: Message, b: Message) => a.timestamp - b.timestamp);
          }
        }

        set({ chats: chatsArray, messages, isLoading: false });
        console.log('Loaded from Firebase:', chatsArray.length, 'chats');
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.error('Error loading from DB:', error);
      set({ isLoading: false });
    }
  },

  updateChat: (chatId: string, updates: Partial<Chat>) => set((state) => ({
    chats: state.chats.map((chat) =>
      chat.id === chatId ? { ...chat, ...updates } : chat
    ),
  })),
}));