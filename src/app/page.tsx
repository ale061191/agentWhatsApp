'use client';

import Sidebar from '@/components/Sidebar';
import ChatArea from '@/components/ChatArea';

export default function Home() {
  return (
    <main className="flex h-screen overflow-hidden" style={{ background: 'linear-gradient(135deg, #0a0a0a 0%, #111111 50%, #0a0a0a 100%)' }}>
      <Sidebar />
      <ChatArea />
    </main>
  );
}