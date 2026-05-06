'use client';

import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { Send, MoreVertical, Bot, Paperclip, Smile, Phone, Video, Settings } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Message } from '@/types';

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
  const { chats, messages, selectedChatId, addMessage, updateChatAiStatus, messages: allMessages, loadFromDB } = useStore();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);

  const selectedChat = chats.find(c => c.id === selectedChatId);
  const chatMessages = selectedChatId ? allMessages[selectedChatId] || [] : [];

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
        <div className="text-center flex flex-col items-center">
          <div className="flex items-center gap-4 mb-2">
            <Bot className="w-16 h-16 text-[#39ff14]" />
            <div>
              <h2 className="text-3xl font-bold text-white">NOVA TECH AI</h2>
              <p className="text-[#25d366] text-lg">Asistente Inteligente</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col" style={{ background: 'radial-gradient(ellipse at top, rgba(37,211,102,0.05) 0%, #0d0d0d 50%)' }}>
      <div className="glass flex items-center justify-between border-b border-[rgba(37,211,102,0.2)]" style={{ paddingBottom: '15px', paddingLeft: '15px', paddingTop: '15px', paddingRight: '15px' }}>
        <div className="flex items-center gap-[12px]">
          <div className="w-[40px] h-[40px] rounded-full bg-[#25d366] flex items-center justify-center text-black text-[13px] font-bold shrink-0">
            {selectedChat?.name ? getInitials(selectedChat.name) : selectedChat?.phone.slice(-2)}
          </div>
          <div>
            <h2 className="font-bold text-white text-[15px]">{selectedChat?.name || selectedChat?.phone}</h2>
            <p className="text-xs text-[#25d366]">{selectedChat?.phone}</p>
          </div>
        </div>

        <div className="flex items-center gap-[4px]">
          <div className="flex items-center gap-[6px] bg-[#1f252d] px-[12px] py-[6px] rounded-[20px]">
            <Bot className={`w-[16px] h-[16px] ${selectedChat?.aiEnabled ? 'text-[#39ff14]' : 'text-gray-500'}`} />
            <span className="text-xs text-gray-400">AI</span>
            <Switch
              checked={selectedChat?.aiEnabled || false}
              onCheckedChange={(checked) => updateChatAiStatus(selectedChatId, checked)}
              className="data-[state=checked]:bg-[#39ff14] h-[22px] w-[40px]"
            />
          </div>
          {/* <button className="w-[40px] h-[40px] flex items-center justify-center rounded-full hover:bg-[rgba(37,211,102,0.15)] transition-all">
            <Phone className="w-5 h-5 text-gray-400" />
          </button>
          <button className="w-[40px] h-[40px] flex items-center justify-center rounded-full hover:bg-[rgba(37,211,102,0.15)] transition-all">
            <Video className="w-5 h-5 text-gray-400" />
          </button> */}
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="w-[40px] h-[40px] flex items-center justify-center rounded-full hover:bg-[rgba(37,211,102,0.15)] transition-all"
          >
            <Settings className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="glass p-4 border-b border-[rgba(37,211,102,0.2)]">
          <div className="glass-card p-4 rounded-xl">
            <h3 className="text-[#25d366] font-bold mb-3">Configuración NOVA TECH AI</h3>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Estado del Asistente</span>
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

      <div className="flex-1 overflow-y-auto p-[16px_24px] flex flex-col gap-[8px]" style={{ marginBottom: '10px' }}>
        {chatMessages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === 'agent' ? 'justify-end' : 'justify-start'}`}
            style={{ marginTop: '8px', marginBottom: '8px' }}
          >
            <div
              className={`max-w-[75%] ${
                msg.sender === 'agent'
                  ? 'bg-[#00a884] text-white rounded-[7.5px_7.5px_0_7.5px]'
                  : 'bg-[#2d333b] text-white rounded-[7.5px_7.5px_7.5px_7.5px]'
              }`}
              style={{ 
                padding: '10px 14px',
                marginRight: msg.sender === 'agent' ? '16px' : '0',
                marginLeft: msg.sender === 'user' ? '16px' : '0'
              }}
            >
              <p className="text-[15px] leading-[19px]">{msg.content}</p>
              <div className="flex items-center justify-end gap-[4px] mt-[4px]">
                <span className="text-[11px] opacity-70">{formatTime(msg.timestamp)}</span>
                {msg.sender === 'agent' && (
                  <span className="text-[11px]">
                    {msg.status === 'delivered' ? '✓✓' : '✓'}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="glass p-[8px_12px] border-t border-[rgba(37,211,102,0.2)]">
        <div className="flex items-center gap-[8px]">
          <button className="w-[40px] h-[40px] flex items-center justify-center rounded-full hover:bg-[rgba(37,211,102,0.15)] transition-all shrink-0">
            <Paperclip className="w-6 h-6 text-gray-400" />
          </button>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe un mensaje..."
            className="flex-1 px-[14px] py-[10px] bg-[#1f252d] text-white text-[15px] placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#25d366]"
            style={{ borderRadius: '8px', padding: '10px 14px', marginTop: '15px', marginBottom: '15px' }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="w-[40px] h-[40px] bg-[#00a884] text-white rounded-full hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center shrink-0"
            style={{ marginRight: '12px', marginLeft: '8px' }}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}