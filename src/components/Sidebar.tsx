'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';
import { Bot, Search } from 'lucide-react';

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
  const { chats, selectedChatId, setSelectedChat, isLoading } = useStore();
  const subscribeToDB = (useStore as any).getState().subscribeToDB;
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (subscribeToDB) {
      subscribeToDB();
      setLoading(false);
    }
  }, [subscribeToDB]);

  return (
    <div className="w-[400px] h-screen glass flex flex-col box-border">
      <div className="p-[12px_16px] pb-[12px] glass border-b border-[rgba(37,211,102,0.2)]">
        <div className="flex items-center gap-[10px] mb-4">
          <Bot className="w-10 h-10 text-[#39ff14]" />
          <div>
            <h1 className="text-lg font-bold text-white">NOVA TECH AI</h1>
            <p className="text-xs text-[#25d366]">Asistente Virtual</p>
          </div>
        </div>
        <div className="relative flex items-center bg-[#1f252d]" style={{ borderRadius: '8px', padding: '8px 12px', margin: '15px 15px 15px 15px' }}>
          <Search 
            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" 
          />
          <input
            type="text"
            placeholder="Buscar conversaciones..."
            className="w-full pl-12 pr-4 py-2 bg-transparent text-white text-[15px] placeholder-gray-500 focus:outline-none"
            style={{ borderRadius: '8px' }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: '4px 0' }}>
        {loading || isLoading ? (
          <div className="p-8 px-6 text-center text-gray-500 text-sm">
            <div className="glass-card p-6 rounded-xl">
              <p>Cargando...</p>
            </div>
          </div>
        ) : chats.length === 0 ? (
          <div className="p-8 px-6 text-center text-gray-500 text-sm">
            <div className="glass-card p-6 rounded-xl">
              <p>No hay conversaciones aún</p>
              <p className="text-xs mt-2 text-gray-600">Los mensajes llegarán aquí</p>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: '8px' }}></div>
        )}
        {chats.map((chat) => (
          <div
            key={chat.id}
            onClick={() => setSelectedChat(chat.id)}
            className={`flex items-center cursor-pointer transition-all hover:bg-[rgba(37,211,102,0.1)] ${
              selectedChatId === chat.id ? 'bg-[rgba(37,211,102,0.15)] border-l-4 border-l-[#25d366]' : ''
            }`}
            style={{ padding: '10px 12px', gap: '10px' }}
          >
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#25d366] to-[#39ff14] flex items-center justify-center text-black text-sm font-bold neon-glow shrink-0">
              {chat.name ? getInitials(chat.name) : chat.phone.slice(-2)}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-medium text-base truncate text-white">
                  {chat.name || chat.phone}
                </span>
                <span className="text-xs text-[#25d366] ml-2">
                  {formatTime(chat.lastMessageTime)}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-sm text-gray-400 truncate">
                  {chat.lastMessage || 'Sin mensajes'}
                </span>
                {chat.unreadCount > 0 && (
                  <span className="min-w-[22px] h-[22px] px-1.5 ml-2 bg-gradient-to-r from-[#25d366] to-[#39ff14] rounded-full text-black text-xs font-bold flex items-center justify-center neon-glow shrink-0">
                    {chat.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="p-[12px_16px] glass border-t border-[rgba(37,211,102,0.2)]">
        <div className="text-center text-xs text-gray-500">
          <span className="text-[#25d366]">NOVA TECH AI</span> v1.0
        </div>
      </div>
    </div>
  );
}