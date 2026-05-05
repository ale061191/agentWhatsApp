import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone, message, chatHistory } = body;

    if (!phone || !message || !GOOGLE_API_KEY) {
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
      console.error('Gemini API error:', data);
      return NextResponse.json(
        { error: data.error?.message || 'Failed to generate response' },
        { status: response.status }
      );
    }

    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiResponse) {
      return NextResponse.json(
        { error: 'No response from AI' },
        { status: 500 }
      );
    }

    const sendResponse = await fetch(`${WHAPI_BASE_URL}/sendMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHAPI_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        text: { body: aiResponse },
      }),
    });

    const sendData = await sendResponse.json();

    return NextResponse.json({ 
      success: true, 
      response: aiResponse,
      whapi: sendData 
    });
  } catch (error) {
    console.error('Error in AI handler:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}