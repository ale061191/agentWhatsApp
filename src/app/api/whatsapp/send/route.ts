import { NextRequest, NextResponse } from 'next/server';

const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

/**
 * Formats a phone number for WHAPI delivery.
 * WHAPI requires: phone@s.whatsapp.net
 */
function toWhatsAppId(phone: string): string {
  // If already has suffix, return as-is
  if (phone.includes('@')) return phone;
  // Strip any non-digit chars and add suffix
  const clean = phone.replace(/\D/g, '');
  return clean + '@s.whatsapp.net';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, text } = body;

    if (!to || !text || !WHAPI_TOKEN) {
      console.error('[SEND] Missing fields - to:', !!to, 'text:', !!text, 'token:', !!WHAPI_TOKEN);
      return NextResponse.json(
        { error: 'Missing required fields or token not configured' },
        { status: 400 }
      );
    }

    const whapiTo = toWhatsAppId(to);
    console.log('[SEND] Sending message to:', whapiTo, '| Text:', text.substring(0, 50));

    const response = await fetch(`${WHAPI_BASE_URL}/messages/text`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHAPI_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        to: whapiTo,
        body: text,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[SEND] WHAPI error:', response.status, JSON.stringify(data));
      return NextResponse.json(
        { error: data.message || 'Failed to send message' },
        { status: response.status }
      );
    }

    console.log('[SEND] Message sent successfully');
    return NextResponse.json(data);
  } catch (error) {
    console.error('[SEND] Error sending message:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}