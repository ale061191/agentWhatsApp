'use client';

import { useStore } from '@/store/useStore';
import { Search, MoreVertical } from 'lucide-react';

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Ayer';
  } else if (diffDays < 7) {
    return date.toLocaleDateString('es-ES', { weekday: 'short' });
  }
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function Sidebar() {
  const { chats, selectedChatId, setSelectedChat } = useStore();

  return (
    <div className="w-[400px] h-screen bg-[#fefefe] border-r border-[#e0e0e0] flex flex-col">
      <div className="p-3 bg-[#fefefe] border-b border-[#e0e0e0]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar o iniciar nueva conversación"
            className="w-full pl-10 pr-4 py-2 bg-[#f0f2f5] border-none rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#25d366]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            No hay conversaciones aún
          </div>
        ) : (
          chats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => setSelectedChat(chat.id)}
              className={`flex items-center p-3 cursor-pointer transition-colors hover:bg[#f5f6f7] ${
                selectedChatId === chat.id ? 'bg-[#f0f2f5]' : ''
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-[#25d366] flex items-center justify-center text-white text-sm font-medium">
                {chat.name ? getInitials(chat.name) : chat.phone.slice(-2)}
              </div>
              
              <div className="flex-1 ml-3 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm truncate text-[#333]">
                    {chat.name || chat.phone}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatTime(chat.lastMessageTime)}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-sm text-gray-500 truncate">
                    {chat.lastMessage || 'Sin mensajes'}
                  </span>
                  {chat.unreadCount > 0 && (
                    <span className="min-w-[18px] h-[18px] px-1 bg-[#25d366] rounded-full text-white text-xs flex items-center justify-center">
                      {chat.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}