'use client';

import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { Send, MoreVertical, Bot, Paperclip, Smile, Mic, Image } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function ChatArea() {
  const { chats, messages, selectedChatId, addMessage, updateChatAiStatus } = useStore();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const selectedChat = chats.find(c => c.id === selectedChatId);
  const chatMessages = selectedChatId ? messages[selectedChatId] || [] : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSend = async () => {
    if (!inputValue.trim() || !selectedChatId || !token) return;

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
          token: token,
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
      <div className="flex-1 flex items-center justify-center bg-[#efeae2]">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-4">💬</div>
          <p className="text-lg">Selecciona una conversación</p>
          <p className="text-sm mt-2">para comenzar a chatear</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#efeae2]">
      <div className="bg-[#fefefe] p-3 border-b border-[#e0e0e0] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#25d366] flex items-center justify-center text-white text-sm font-medium">
            {selectedChat?.name?.slice(0, 2).toUpperCase() || selectedChat?.phone.slice(-2)}
          </div>
          <div>
            <h2 className="font-medium text-sm text-[#333]">{selectedChat?.name || selectedChat?.phone}</h2>
            <p className="text-xs text-gray-400">{selectedChat?.phone}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Bot className={`w-4 h-4 ${selectedChat?.aiEnabled ? 'text-[#25d366]' : 'text-gray-400'}`} />
            <span className="text-xs text-gray-500">AI</span>
            <Switch
              checked={selectedChat?.aiEnabled || false}
              onCheckedChange={(checked) => updateChatAiStatus(selectedChatId, checked)}
            />
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 hover:bg-[#f0f0f0] rounded-full transition-colors"
          >
            <MoreVertical className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="bg-[#fefefe] p-3 border-b border-[#e0e0e0]">
          <label className="text-xs text-gray-500 block mb-1">Token de WHAPI</label>
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Ingresa tu token de WHAPI"
            className="w-full px-3 py-2 border border-[#e0e0e0] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#25d366]"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {chatMessages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === 'agent' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[70%] px-3 py-2 rounded-lg text-sm ${
                msg.sender === 'agent'
                  ? 'bg-[#d9fdd3] rounded-br-none'
                  : 'bg-[#ffffff] rounded-bl-none'
              }`}
            >
              <p className="text-[#333]">{msg.content}</p>
              <div className="flex items-center justify-end gap-1 mt-1">
                <span className="text-[10px] text-gray-400">{formatTime(msg.timestamp)}</span>
                {msg.sender === 'agent' && (
                  <span className="text-[10px] text-gray-400">
                    {msg.status === 'delivered' ? '✓✓' : '✓'}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="bg-[#fefefe] p-3 border-t border-[#e0e0e0]">
        <div className="flex items-center gap-2">
          <button className="p-2 hover:bg-[#f0f0f0] rounded-full transition-colors">
            <Paperclip className="w-5 h-5 text-gray-500" />
          </button>
          <button className="p-2 hover:bg-[#f0f0f0] rounded-full transition-colors">
            <Smile className="w-5 h-5 text-gray-500" />
          </button>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe un mensaje..."
            className="flex-1 px-4 py-2 bg-[#f0f2f5] border-none rounded-full text-sm focus:outline-none focus:ring-1 focus:ring-[#25d366]"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="p-2 bg-[#25d366] text-white rounded-full hover:bg-[#20bd5a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}