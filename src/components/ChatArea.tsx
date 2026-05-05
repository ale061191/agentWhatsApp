'use client';

import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { Send, MoreVertical, Bot, Paperclip, Smile, Phone, Video, Settings } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function ChatArea() {
  const { chats, messages, selectedChatId, addMessage, updateChatAiStatus } = useStore();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);

  const selectedChat = chats.find(c => c.id === selectedChatId);
  const chatMessages = selectedChatId ? messages[selectedChatId] || [] : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSend = async () => {
    if (!inputValue.trim() || !selectedChatId) return;

    const userMessage = {
      id: `msg_${Date.now()}`,
      chatId: selectedChatId,
      content: inputValue,
      sender: 'agent' as const,
      timestamp: Date.now(),
      status: 'sent' as const,
    };

    addMessage(selectedChatId, userMessage);
    setInputValue('');

    try {
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: selectedChat?.phone,
          text: inputValue,
        }),
      });

      if (response.ok) {
        const updatedMsg = { ...userMessage, status: 'delivered' as const };
        addMessage(selectedChatId, updatedMsg);
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!selectedChatId) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: 'radial-gradient(ellipse at center, rgba(37,211,102,0.1) 0%, #0d0d0d 70%)' }}>
        <div className="text-center">
          <div className="glass-card p-10 rounded-2xl neon-glow mb-6">
            <div className="text-6xl mb-4">⚡</div>
            <h2 className="text-2xl font-bold text-white mb-2">Voltaje Agent</h2>
            <p className="text-[#25d366]">Asistente Inteligente</p>
          </div>
          <div className="glass p-4 rounded-xl">
            <p className="text-gray-400">Selecciona una conversación</p>
            <p className="text-xs text-gray-600 mt-2">para comenzar a chatear</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col" style={{ background: 'radial-gradient(ellipse at top, rgba(37,211,102,0.05) 0%, #0d0d0d 50%)' }}>
      <div className="glass p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#25d366] to-[#39ff14] flex items-center justify-center text-black text-sm font-bold neon-glow">
            {selectedChat?.name ? getInitials(selectedChat.name) : selectedChat?.phone.slice(-2)}
          </div>
          <div>
            <h2 className="font-bold text-white">{selectedChat?.name || selectedChat?.phone}</h2>
            <p className="text-xs text-[#25d366]">{selectedChat?.phone}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 glass px-3 py-1.5 rounded-full">
            <Bot className={`w-4 h-4 ${selectedChat?.aiEnabled ? 'text-[#39ff14]' : 'text-gray-500'}`} />
            <span className="text-xs text-gray-400">AI</span>
            <Switch
              checked={selectedChat?.aiEnabled || false}
              onCheckedChange={(checked) => updateChatAiStatus(selectedChatId, checked)}
              className="data-[state=checked]:bg-[#39ff14]"
            />
          </div>
          <button className="p-2 glass rounded-full hover:bg-[rgba(37,211,102,0.2)] transition-all">
            <Phone className="w-5 h-5 text-gray-400" />
          </button>
          <button className="p-2 glass rounded-full hover:bg-[rgba(37,211,102,0.2)] transition-all">
            <Video className="w-5 h-5 text-gray-400" />
          </button>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 glass rounded-full hover:bg-[rgba(37,211,102,0.2)] transition-all"
          >
            <Settings className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="glass p-4 border-b border-[rgba(37,211,102,0.2)]">
          <div className="glass-card p-4 rounded-xl">
            <h3 className="text-[#25d366] font-bold mb-3">Configuración</h3>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Estado del Agent</span>
              <span className={`text-sm font-bold ${selectedChat?.aiEnabled ? 'text-[#39ff14]' : 'text-red-500'}`}>
                {selectedChat?.aiEnabled ? 'Activo' : 'Desactivado'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Mensajes hoy</span>
              <span className="text-sm text-white">{chatMessages.length}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {chatMessages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === 'agent' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[70%] px-4 py-3 rounded-2xl text-sm ${
                msg.sender === 'agent'
                  ? 'glass-card text-white rounded-br-none'
                  : 'glass text-white rounded-bl-none'
              }`}
            >
              <p>{msg.content}</p>
              <div className="flex items-center justify-end gap-1 mt-2">
                <span className="text-[10px] text-gray-500">{formatTime(msg.timestamp)}</span>
                {msg.sender === 'agent' && (
                  <span className="text-[10px] text-[#25d366]">
                    {msg.status === 'delivered' ? '✓✓' : '✓'}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="glass p-4 border-t border-[rgba(37,211,102,0.2)]">
        <div className="flex items-center gap-3">
          <button className="p-2 glass rounded-full hover:bg-[rgba(37,211,102,0.2)] transition-all">
            <Paperclip className="w-5 h-5 text-gray-400" />
          </button>
          <button className="p-2 glass rounded-full hover:bg-[rgba(37,211,102,0.2)] transition-all">
            <Smile className="w-5 h-5 text-gray-400" />
          </button>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe un mensaje..."
            className="flex-1 px-4 py-3 glass-card rounded-full text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#25d366]"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="p-3 bg-gradient-to-r from-[#25d366] to-[#39ff14] text-black rounded-full hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all neon-glow"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}