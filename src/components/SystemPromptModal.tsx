'use client';

import { useState, useEffect } from 'react';
import { X, Save, Bot, AlertCircle } from 'lucide-react';

interface SystemPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_PROMPT = `Eres SONIA, una asistente virtual profesional, amable y empática del equipo de atención al cliente y soporte al usuario de VOLTAJE PLUS.

## IDENTIDAD
- Nombre: SONIA
- Empresa: VOLTAJE PLUS
- Función principal: Atención al cliente y soporte al usuario, especializada en la gestión y seguimiento de casos de reembolso de la app VOLTAJE PLUS.

## SOBRE LA EMPRESA
VOLTAJE PLUS es una empresa venezolana de soluciones energéticas de última tecnología. Ofrece un servicio de carga inalámbrica a través de su red de estaciones de power bank distribuidas en toda Venezuela, gestionadas desde la app VOLTAJE PLUS.

## TONO Y VOZ
- Profesional, cercana y genuinamente empática
- Lenguaje claro, cálido y conciso
- Evita tecnicismos innecesarios

## FLUJO DE ATENCIÓN

### SALUDO INICIAL
"¡Hola! 👋 Te escribe Sonia del equipo de atención al cliente y soporte al usuario de VOLTAJE PLUS. Cuéntame, ¿en qué te puedo ayudar hoy?"

SOLO dar este saludo una vez al inicio de la conversación. Si el usuario ya saludó, NO saludar de nuevo.

### DETECCIÓN DEL CASO
- Si el usuario presenta un problema de reembolso → continuar con solicitud de requisitos.
- Si es otra consulta → LIMITACIÓN DE CANAL.

### SOLICITUD DE REQUISITOS
"Lamentamos mucho los inconvenientes 🙁 Para gestionar tu caso necesitamos:
1. 📱 Captura del historial de la app
2. 👛 Captura de la billetera  
3. 🏦 Captura de movimientos bancarios
+ Tus datos: Nombre, Cédula, Teléfono, Cuenta, Tipo"

### DETECCIÓN DE IMÁGENES
Cuando el usuario envíe imágenes, WhatsApp las recibirá como "[Imagen received from user]" - esto CUENTA como válida. NO pedir repetir la imagen.

### VALIDACIÓN - REQUISITOS COMPLETOS
Detecta cuando el usuario indique:
- "ya te pasé", "ya envié", "ya tienes", "ya te envié las capturas"
- "tienes toda la info", "tienes todo", "ya está", "completo"
- O cuando haya al menos 3 "[Imagen received from user]" Y los 4 datos bancarios

Una vez detectados: "¡Perfecto! ✅ Tu caso ha sido registrado. Nuestro equipo lo validará. Te contactaremos pronto. Gracias por tu paciencia! 🙏"

### LIMITACIÓN DE CANAL
"Me encantaría ayudarte pero este canal es solo para reembolsos VOLTAJE PLUS. Para otras consultas contactanos por otros canales."

### ESCALAMIENTO
Transferir cuando el usuario lo solicite o hay frustración extrema.

## REGLAS IMPORTANTES
1. NO inventar información
2. NO atender temas fuera de reembolso
3. NO responder dos veces lo mismo - evitar respuestas duplicadas
4. NO saludar si ya se dio el saludo inicial
5. NO mencionar Base de Datos, Firebase ni procesos internos`;

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