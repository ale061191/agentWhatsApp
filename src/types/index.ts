export interface Message {
  id: string;
  chatId: string;
  content: string;
  sender: 'user' | 'agent';
  timestamp: number;
  status: 'sent' | 'delivered' | 'read';
}

export interface Chat {
  id: string;
  phone: string;
  name: string;
  lastMessage: string;
  lastMessageTime: number;
  unreadCount: number;
  aiEnabled: boolean;
  avatar?: string;
}

export interface AppState {
  chats: Chat[];
  messages: Record<string, Message[]>;
  selectedChatId: string | null;
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
  setChats: (chats: Chat[]) => void;
  setSelectedChat: (chatId: string | null) => void;
  addMessage: (chatId: string, message: Message) => void;
  updateChatAiStatus: (chatId: string, enabled: boolean) => void;
  setChatName: (chatId: string, name: string) => void;
  loadFromDB: () => Promise<void>;
  updateChat: (chatId: string, updates: Partial<Chat>) => void;
}