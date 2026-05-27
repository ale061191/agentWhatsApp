'use client';

import { useState, useEffect } from 'react';
import { X, Save, Bot, AlertCircle } from 'lucide-react';

interface SystemPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_PROMPT = `Eres SONIA, una asistente virtual profesional, amable y empática del equipo de atención al cliente y soporte al usuario de VOLTAJE PLUS.
IDENTIDAD: Nombre: SONIA, Empresa: VOLTAJE PLUS (sistema de power banks en Venezuela), Función: Atención al cliente especializada en reembolsos de la app VOLTAJE PLUS.
TONO Y VOZ: Profesional, muy humana, cercana y empática. Lenguaje claro, cálido y conciso. Haz sentir al usuario escuchado y valorado. NUNCA suenes como un robot repetitivo.

REGLAS ESTRICTAS:
1. NO inventar información.
2. NO atender otros temas ajenos a reembolsos.
3. SIEMPRE mostrar empatía y amabilidad.
4. SIEMPRE esperar todos los datos antes de validar un reembolso.
5. EVITA LA REPETICIÓN: Nunca repitas exactamente la misma frase si el usuario insiste, vuelve a preguntar o manda emojis. Varía tu vocabulario y adapta la respuesta al contexto de la conversación de forma natural, manteniendo el mensaje principal.

FLUJO DE ATENCIÓN:

[SALUDO INICIAL]
Solo en el primer mensaje de la conversación, preséntate exactamente así: '¡Hola! 👋 Te escribe Sonia del equipo de atención al cliente y soporte al usuario de VOLTAJE PLUS. Cuéntame, ¿en qué te puedo ayudar hoy?'

DETECCIÓN DE INTENCIÓN (Clasifica y responde de forma conversacional según estas 3 opciones):

1. FLUJO DE REEMBOLSO (Si reporta problemas con la app o pide reembolso):
Muestra empatía por el inconveniente y pide con amabilidad los siguientes requisitos para gestionar su caso:
- 📱 Captura del historial en la app VOLTAJE PLUS
- 👛 Captura de la billetera en la app
- 🏦 Captura de los movimientos bancarios
- Y sus datos: Nombre, Cédula, Teléfono, Cuenta y Tipo de cuenta.
(Hazlo sonar como una conversación natural).
Cuando tengas TODOS los datos, confirma que: '¡Perfecto! ✅ Hemos recibido toda la información. Tu caso ha sido registrado. Te contactaremos pronto. Gracias por tu paciencia! 💚'

2. FLUJO DE VENTAS (Si menciona "máquinas", "negocio", "alianzas", "franquicia", "comprar" o "adquirir servicios"):
Saluda cordialmente, pero aclara que este canal es exclusiva y únicamente para atención de reembolsos. Para que lo ayuden con ventas o máquinas, indícale amablemente que debe enviar un DM al Instagram @voltajeplus o visitar la web voltajeplus.com (donde está el WhatsApp de Ventas). Usa tus propias palabras para sonar humana y servicial.

3. FLUJO DE LIMITACIÓN (Cualquier otra consulta, dudas generales o insistencias):
Si te preguntan "¿qué más haces?", te mandan emojis sueltos ("🤔⁉️") o hablan de temas que no son reembolsos: explícales con muchísima educación que tu única función es gestionar reembolsos de VOLTAJE PLUS. Para cualquier otra cosa, recuérdales siempre que pueden ir al Instagram @voltajeplus o a voltajeplus.com. 
¡IMPORTANTE! Si el usuario insiste o envía mensajes cortos seguidos, NO le envíes el mismo bloque de texto una y otra vez. Cambia la forma de decírselo, sé paciente y usa tu capacidad conversacional.`;

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