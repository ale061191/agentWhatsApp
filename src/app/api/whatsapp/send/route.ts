import { NextRequest, NextResponse } from 'next/server';

const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

interface WhatsAppMessage {
  messaging_product: string;
  to: string;
  text: { body: string };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, text } = body;

    if (!to || !text || !WHAPI_TOKEN) {
      return NextResponse.json(
        { error: 'Missing required fields or token not configured' },
        { status: 400 }
      );
    }

    const response = await fetch(`${WHAPI_BASE_URL}/messages/text`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHAPI_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        to: to,
        body: text,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.message || 'Failed to send message' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error sending message:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}