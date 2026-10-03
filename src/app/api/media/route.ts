import { NextRequest, NextResponse } from 'next/server';

const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const messageId = searchParams.get('id');
    const mediaId = searchParams.get('mediaId');

    if (!messageId && !mediaId) {
      return NextResponse.json({ error: 'Missing id or mediaId' }, { status: 400 });
    }

    // Intentar descargar media desde WHAPI
    // Endpoint tentativo: /media/{id} o /messages/{id}/media
    const id = mediaId || messageId!;
    const url = `${WHAPI_BASE_URL}/media/${id}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${WHAPI_TOKEN}`,
      },
    });

    if (!res.ok) {
      // Fallback: intentar endpoint alternativo
      const altUrl = `${WHAPI_BASE_URL}/messages/${messageId}/media`;
      const altRes = await fetch(altUrl, {
        headers: {
          Authorization: `Bearer ${WHAPI_TOKEN}`,
        },
      });
      if (!altRes.ok) {
        return new NextResponse('Media not found', { status: 404 });
      }
      const buffer = Buffer.from(await altRes.arrayBuffer());
      const contentType = altRes.headers.get('content-type') || 'application/octet-stream';
      return new NextResponse(buffer, {
        headers: { 'Content-Type': contentType },
      });
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    return new NextResponse(buffer, {
      headers: { 'Content-Type': contentType },
    });
  } catch (e) {
    console.error('[MEDIA_PROXY] Error', e);
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 });
  }
}
