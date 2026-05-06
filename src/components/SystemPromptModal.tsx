'use client';

import { useState, useEffect } from 'react';
import { X, Save, Bot, AlertCircle } from 'lucide-react';

interface SystemPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_PROMPT = `Eres SONIA, una asistente virtual profesional, amable y empática del equipo de atención al cliente y soporte al usuario de VOLTAJE PLUS. IDENTIDAD: Nombre: SONIA, Empresa: VOLTAJE PLUS (sistema de power banks en Venezuela), Función: Atención al cliente especializada en reembolsos de la app VOLTAJE PLUS. TONO Y VOZ: Profesional, cercana y empática. Lenguaje claro, cálido y conciso. Hacer sentir al usuario escuchado y valorado. FLUJO: SALUDO INICIAL (solo una vez): '¡Hola! 👋 Te escribe Sonia del equipo de atención al cliente y soporte al usuario de VOLTAJE PLUS. Cuéntame, ¿en qué te puedo ayudar hoy?' DETECCIÓN: Si pide reembolso → continuar. Si otra consulta → LIMITACIÓN. SOLICITUD REQUISITOS: 'Lamentamos mucho los inconveniente 🙏. Para gestionar tu caso necesitamos: 1)📱Captura historial app VOLTAJE PLUS 2)👛Captura billetera app 3)🏦Captura movimientos bancarios + Tus datos:Nombre,Cédula,Teléfono,Cuenta,Tipo'. VALIDACIÓN: Cuando tenga todo: '¡Perfecto! ✅ Hemos recibido toda la información. Tu caso ha sido registrado. Te contactaremos pronto. Gracias por tu paciencia! 💚'. LIMITACIÓN: 'Me encantaría ayudarte😊 pero este canal es solo para reembolsos de VOLTAJE PLUS. Para otras consultas contáctanos por otros canales. ¡Gracias! 💚'. ESCALAMIENTO: Transferir a agente humano si lo solicita, caso muy complejo, o frustración extrema. REGLAS: 1.NO inventar información 2.NO atender otros temas 3.SIEMPRE mostrar empatía 4.SIEMPRE esperar todos requisitos antes de confirmar 5.SIEMPRE saludar al inicio 6.Registrar caso en Firebase silenciosamente al tener todo 7.NUNCA mencionar Firebase al usuario 8.NO enviar notas internas como (texto) 9.NO repetir el mismo mensaje 10.NO saludar dos veces 11.NUNCA preguntar números de pedido 12.NUNCA decir que no puedes ver imágenes 13.UNA respuesta por mensaje del usuario`;

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
        <div 
          className="flex items-center justify-between border-b border-[rgba(37,211,102,0.2)]"
          style={{ paddingLeft: '15px', paddingTop: '15px', paddingRight: '15px', paddingBottom: '15px' }}
        >
          <div className="flex items-center gap-3">
            <Bot className="w-6 h-6 text-[#39ff14]" />
            <h2 className="text-lg font-bold text-white">System Prompt</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-[rgba(255,255,255,0.1)] rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-4">
          <div 
            className="flex items-start gap-2 mb-3 rounded-lg border border-[rgba(37,211,102,0.2)]"
            style={{ paddingLeft: '15px', paddingTop: '15px', paddingRight: '15px', paddingBottom: '15px', backgroundColor: 'rgba(37,211,102,0.1)' }}
          >
            <AlertCircle className="w-5 h-5 text-[#39ff14] shrink-0 mt-0.5" />
            <p className="text-sm text-gray-300">
              Este prompt define la personalidad, conocimiento y comportamiento del agente IA. 
              Sea específico para evitar alucinaciones.
            </p>
          </div>
          
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full h-[400px] bg-[#0d0d0d] text-white text-sm rounded-xl border border-[rgba(37,211,102,0.2)] focus:border-[#25d366] focus:outline-none resize-none font-mono leading-relaxed"
            placeholder="Escribe las instrucciones del agente aquí..."
            style={{ paddingLeft: '15px', paddingTop: '15px', paddingRight: '15px', paddingBottom: '15px' }}
          />
        </div>

        <div 
          className="flex items-center justify-between border-t border-[rgba(37,211,102,0.2)]"
          style={{ paddingLeft: '15px', paddingTop: '15px', paddingRight: '15px', paddingBottom: '15px' }}
        >
          <button
            onClick={() => setPrompt(DEFAULT_PROMPT)}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Restablecer por defecto
          </button>
          
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 text-black font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ paddingLeft: '15px', paddingRight: '15px', paddingTop: '10px', paddingBottom: '10px', borderRadius: '8px', background: 'linear-gradient(to right, #25d366, #39ff14)' }}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Guardando...' : saved ? '✓ Guardado!' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}