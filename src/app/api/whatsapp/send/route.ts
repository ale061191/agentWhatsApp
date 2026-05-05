import { NextRequest, NextResponse } from 'next/server';

const WHAPI_BASE_URL = 'https://whapi.io/api';

interface WhatsAppMessage {
  messaging_product: string;
  to: string;
  text: { body: string };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, text, token } = body;

    if (!to || !text || !token) {
      return NextResponse.json(
        { error: 'Missing required fields: to, text, token' },
        { status: 400 }
      );
    }

    const response = await fetch(`${WHAPI_BASE_URL}/sendMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        text: { body: text },
      } as WhatsAppMessage),
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

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.json(
      { error: 'Token is required' },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(`${WHAPI_BASE_URL}/conversations?count=20`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}