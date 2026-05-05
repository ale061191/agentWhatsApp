import { create } from 'zustand';
import { AppState, Chat, Message } from '@/types';

export const useStore = create<AppState>((set) => ({
  chats: [],
  messages: {},
  selectedChatId: null,

  setChats: (chats: Chat[]) => set({ chats }),

  setSelectedChat: (chatId: string | null) => set({ selectedChatId: chatId }),

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

    return { messages: updatedMessages, chats: updatedChats };
  }),

  updateChatAiStatus: (chatId: string, enabled: boolean) => set((state) => ({
    chats: state.chats.map((chat) =>
      chat.id === chatId ? { ...chat, aiEnabled: enabled } : chat
    ),
  })),

  setChatName: (chatId: string, name: string) => set((state) => ({
    chats: state.chats.map((chat) =>
      chat.id === chatId ? { ...chat, name } : chat
    ),
  })),
}));