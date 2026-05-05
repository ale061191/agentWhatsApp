'use client';

import { useStore } from '@/store/useStore';
import { Search, MoreVertical, Phone, Video } from 'lucide-react';

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
    <div className="w-[400px] h-screen glass flex flex-col">
      <div className="p-4 glass border-b border-[rgba(37,211,102,0.2)]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#25d365]" />
          <input
            type="text"
            placeholder="Buscar conversaciones..."
            className="w-full pl-10 pr-4 py-2.5 glass-card rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#25d366]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            <div className="glass-card p-6 rounded-xl">
              <p>No hay conversaciones aún</p>
              <p className="text-xs mt-2 text-gray-600">Los mensajes lleguen aquí</p>
            </div>
          </div>
        ) : (
          chats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => setSelectedChat(chat.id)}
              className={`flex items-center p-4 cursor-pointer transition-all hover:bg-[rgba(37,211,102,0.1)] border-b border-[rgba(37,211,102,0.1)] ${
                selectedChatId === chat.id ? 'bg-[rgba(37,211,102,0.15)] border-l-2 border-l-[#25d366]' : ''
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#25d366] to-[#39ff14] flex items-center justify-center text-black text-sm font-bold neon-glow">
                {chat.name ? getInitials(chat.name) : chat.phone.slice(-2)}
              </div>
              
              <div className="flex-1 ml-3 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm truncate text-white">
                    {chat.name || chat.phone}
                  </span>
                  <span className="text-xs text-[#25d366]">
                    {formatTime(chat.lastMessageTime)}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-sm text-gray-400 truncate">
                    {chat.lastMessage || 'Sin mensajes'}
                  </span>
                  {chat.unreadCount > 0 && (
                    <span className="min-w-[20px] h-[20px] px-1.5 bg-gradient-to-r from-[#25d366] to-[#39ff14] rounded-full text-black text-xs font-bold flex items-center justify-center neon-glow">
                      {chat.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3 glass border-t border-[rgba(37,211,102,0.2)]">
        <div className="text-center text-xs text-gray-500">
          <span className="text-[#25d366]">Voltaje</span> Agent v1.0
        </div>
      </div>
    </div>
  );
}