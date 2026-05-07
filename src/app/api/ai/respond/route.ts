import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

/**
 * Formats a phone number for WHAPI delivery.
 * WHAPI requires: phone@s.whatsapp.net
 */
function toWhatsAppId(phone: string): string {
  if (phone.includes('@')) return phone;
  const clean = phone.replace(/\D/g, '');
  return clean + '@s.whatsapp.net';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone, message, chatHistory } = body;

    if (!phone || !message || !GOOGLE_API_KEY) {
      console.error('[AI-RESPOND] Missing fields - phone:', !!phone, 'message:', !!message, 'apiKey:', !!GOOGLE_API_KEY);
      return NextResponse.json(
        { error: 'Missing required fields or API keys not configured' },
        { status: 400 }
      );
    }

    const historyText = chatHistory
      ?.slice(-10)
      ?.map((msg: { sender: string; content: string }) => 
        `${msg.sender === 'agent' ? 'Agente' : 'Cliente'}: ${msg.content}`
      )
      ?.join('\n') || '';

    const prompt = `Eres un asistente de atención al cliente profesional, amigable y eficiente. 
    Historial de la conversación:
    ${historyText}
    
    Nuevo mensaje del cliente: ${message}
    
    Responde de manera profesional, breve y útil.`;

    console.log('[AI-RESPOND] Calling Gemini for phone:', phone);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 500,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('[AI-RESPOND] Gemini API error:', data);
      return NextResponse.json(
        { error: data.error?.message || 'Failed to generate response' },
        { status: response.status }
      );
    }

    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiResponse) {
      console.error('[AI-RESPOND] No text in Gemini response:', JSON.stringify(data).substring(0, 300));
      return NextResponse.json(
        { error: 'No response from AI' },
        { status: 500 }
      );
    }

    // Send reply to WhatsApp via WHAPI - CORRECT endpoint and format
    const whapiTo = toWhatsAppId(phone);
    console.log('[AI-RESPOND] Sending WHAPI message to:', whapiTo);

    const sendResponse = await fetch(`${WHAPI_BASE_URL}/messages/text`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHAPI_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: whapiTo,
        body: aiResponse,
      }),
    });

    const sendData = await sendResponse.json();

    if (!sendResponse.ok) {
      console.error('[AI-RESPOND] WHAPI send error:', sendResponse.status, JSON.stringify(sendData));
    } else {
      console.log('[AI-RESPOND] Message sent via WHAPI successfully');
    }

    return NextResponse.json({ 
      success: true, 
      response: aiResponse,
      whapi: sendData 
    });
  } catch (error) {
    console.error('[AI-RESPOND] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}