'use client';

import { useState, useEffect } from 'react';
import { X, Save, Bot, AlertCircle } from 'lucide-react';

interface SystemPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_PROMPT = `Eres Nova Tech AI, un asistente virtual profesional y amable de atención al cliente.

## IDENTIDAD
- Nombre: Nova Tech AI
- Empresa: [NOMBRE_DE_TU_EMPRESA]
- Funcional principal: [DESCRIBE_QUÉ_HACE_TU_NEGOCIO]

## TONO Y VOZ
- Profesional pero cercanía amigable
- Usa un lenguaje claro y conciso
- Evita tecnicismos innecesarios

## DIRECTRICES
1. Responde siempre basado en el conocimiento proporcionado
2. Si no sabes algo, admitirlo honestamente y ofrecer help来找 humano
3. No inventar información (alucinaciones)
4. Mantener al cliente feeling valorado

## ACCIONES PERMITIDAS
- Proporcionar información sobre productos/servicios
- Responder preguntas frecuentes
- Tomar notas de solicitudes
- Escalate a un agente humano cuando sea necesario

## PREGUNTAS CLAVE
- [What information do you need to obtener del cliente?]

## ESCALAMIENTO
Cuándo transferir a humano:
- El cliente lo solicita explicitmente
- Issues técnico que no puedes resolver
- Solicitudes complejos de soporte`;

export default function SystemPromptModal({ isOpen, onClose }: SystemPromptModalProps) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function loadPrompt() {
      try {
        const res = await fetch('/api/db?action=getSystemPrompt');
        const data = await res.json();
        if (data.prompt) {
          setPrompt(data.prompt);
        }
      } catch (e) {
        console.error('Error loading prompt:', e);
      }
    }
    if (isOpen) {
      loadPrompt();
    }
  }, [isOpen]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveSystemPrompt',
          prompt,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Error saving prompt:', e);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl mx-4 bg-[#1a1a1a] border border-[rgba(37,211,102,0.3)] rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-[rgba(37,211,102,0.2)]">
          <div className="flex items-center gap-3">
            <Bot className="w-6 h-6 text-[#39ff14]" />
            <h2 className="text-lg font-bold text-white">System Prompt</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-[rgba(255,255,255,0.1] rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-4">
          <div className="flex items-start gap-2 mb-3 p-3 bg-[rgba(37,211,102,0.1)] rounded-lg border border-[rgba(37,211,102,0.2)]">
            <AlertCircle className="w-5 h-5 text-[#39ff14] shrink-0 mt-0.5" />
            <p className="text-sm text-gray-300">
              Este prompt define la personalidad, conocimiento y comportamiento del agente IA. 
              Sea específico para evitar alucinaciones.
            </p>
          </div>
          
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full h-[400px] p-4 bg-[#0d0d0d] text-white text-sm rounded-xl border border-[rgba(37,211,102,0.2)] focus:border-[#25d366] focus:outline-none resize-none font-mono leading-relaxed"
            placeholder="Escribe las instrucciones del agente aquí..."
          />
        </div>

        <div className="flex items-center justify-between p-4 border-t border-[rgba(37,211,102,0.2)]">
          <button
            onClick={() => setPrompt(DEFAULT_PROMPT)}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Restablecer por defecto
          </button>
          
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-[#25d366] to-[#39ff14] text-black font-bold rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Guardando...' : saved ? '✓ Guardado!' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}