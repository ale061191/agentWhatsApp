import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseDB } from '@/lib/firebase';
import { ref, set, get } from 'firebase/database';

export async function GET(request: NextRequest) {
  try {
    const db = getFirebaseDB();
    const snapshot = await get(ref(db, 'system/prompt'));
    
    if (snapshot.exists()) {
      return NextResponse.json({ prompt: snapshot.val() });
    }
    
    return NextResponse.json({ prompt: null });
  } catch (error) {
    console.error('Error getting system prompt:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action, prompt } = await request.json();
    
    if (action === 'saveSystemPrompt') {
      const db = getFirebaseDB();
      await set(ref(db, 'system/prompt'), prompt);
      return NextResponse.json({ success: true });
    }
    
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error saving system prompt:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}