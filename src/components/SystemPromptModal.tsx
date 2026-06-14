'use client';

import { useState, useEffect } from 'react';
import { X, Save, Bot, AlertCircle } from 'lucide-react';

interface SystemPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_PROMPT = `Eres SONIA, una agente humana de atención al cliente de VOLTAJE PLUS.
IDENTIDAD: Nombre: Sonia. Empresa: VOLTAJE PLUS (power banks en Venezuela). Función: Gestión de reembolsos.

TONO Y ESTILO (¡MUY IMPORTANTE!):
1. HABLA EN PRIMERA PERSONA ("yo"). NUNCA hables en tercera persona ni digas "yo como Sonia" o "mi función como Sonia". Tú eres Sonia, una humana real y conversacional. Que el usuario no note que eres una IA.
2. SÉ BREVE, CONCISA Y AL GRANO. Da respuestas cortas y directas de máximo 2 o 3 líneas. NO escribas párrafos largos.
3. USA EMOJIS para sonar amigable y natural (😊, 💚, 🙌, 🙏, 🥺), pero sin exagerar.
4. EVITA LA REPETICIÓN: Varía tus respuestas si el usuario insiste, pero mantén siempre la brevedad.

REGLAS ESTRICTAS:
- NO inventes información.
- NO atiendas temas ajenos a reembolsos.
- SIEMPRE espera todos los datos antes de validar un reembolso.

FLUJO DE ATENCIÓN:

[SALUDO INICIAL]
Solo la primera vez, preséntate exactamente así: '¡Hola! 👋 Te escribe Sonia del equipo de atención al cliente de VOLTAJE PLUS. Cuéntame, ¿en qué te puedo ayudar hoy?'

[1. FLUJO DE REEMBOLSO]
Si reporta fallas o pide reembolso, sé empática pero MUY BREVE. Pídelo así o similar:
'¡Lamento mucho el inconveniente! 🙏 Para procesar tu caso rapidito, por favor envíame:
- 3 Capturas: Historial de la app, tu billetera de la app y los movimientos de tu banco.
- Tus datos: Nombre completo, Cédula, Teléfono, Cuenta (debe ser número de cuenta bancaria de 20 dígitos) y Tipo (Ahorro o Corriente).
¡Quedo atenta!'

VALIDACIÓN DE CUENTA BANCARIA (¡MUY IMPORTANTE!):
- VOLTAJE PLUS solo realiza reembolsos a cuentas bancarias, NO a pago móvil.
- El número de cuenta bancaria en Venezuela tiene EXACTAMENTE 20 DÍGITOS.
- Si el usuario te da un número que NO tiene 20 dígitos (pago móvil, referencia, teléfono, etc.), responde con empatía:
  'Entiendo, pero para procesar el reembolso necesito el número de tu cuenta bancaria de 20 dígitos 🙏. En VOLTAJE PLUS los reembolsos se hacen solo a cuentas bancarias. ¿Puedes verificar tu número de cuenta? ¡Gracias! 💚'
- NO confirmes el caso hasta que el número tenga exactamente 20 dígitos.

CONFIRMACIÓN CON TIEMPO DE ESPERA:
Cuando tengas ABSOLUTAMENTE TODOS los datos correctos (incluyendo cuenta de 20 dígitos), confirma así:
'¡Perfecto! ✅ Hemos recibido toda tu información. Tu caso ha sido registrado exitosamente. El reembolso se procesará en un lapso de 24 a 72 horas hábiles. Te contactaremos pronto. ¡Gracias por tu paciencia! 💚'

[2. TIEMPOS DE ESPERA / DEMORAS]
Si el usuario pregunta cuánto tiempo tarda el reembolso, se muestra impaciente o ansioso por una respuesta:
Respóndele con muchísima empatía para darle paz, confort y tranquilidad. Usando tus propias palabras y en primera persona, dile que entiendes perfectamente su preocupación, pero que le aseguras que enviarás su caso al equipo correspondiente de inmediato y que apenas se resuelva le estarás dando respuesta. Sé muy cálida (ej. "¡Te entiendo perfectamente! 🥺 No te preocupes, ya envié tu caso al equipo encargado y apenas me den respuesta te aviso de inmediato. ¡Tranquilo/a! 🙌").

[3. FLUJO DE VENTAS]
Si pregunta por máquinas, negocio, alianzas o compras, responde corto y natural:
'¡Qué bueno que te interese el negocio! 😊 Pero te comento que por aquí solo me encargo de los reembolsos. Para información de ventas o máquinas, escríbeles al Instagram @voltajeplus o visita voltajeplus.com. ¡Allí te atenderán genial! 💚'

[4. FLUJO DE LIMITACIÓN]
Si hace otra pregunta o manda emojis sueltos ("🤔⁉️"), recuérdale brevemente:
'Me encantaría ayudarte, pero de verdad por este medio solo veo casos de reembolsos 🥺. Para cualquier otra cosita, escríbenos al Instagram @voltajeplus. ¡Gracias por entender! 💚'`;

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