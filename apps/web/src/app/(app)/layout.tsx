'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { api, getAccessToken, setAccessToken } from '@/lib/api';
import { useRealtime } from '@/lib/hooks';

/** Shell autenticado: menu lateral + área do módulo. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (!getAccessToken()) {
        // tenta restaurar sessão pelo refresh cookie
        try {
          const r = await api<{ accessToken: string }>('/auth/refresh', { method: 'POST' }, false);
          setAccessToken(r.accessToken);
        } catch {
          router.replace('/login');
          return;
        }
      }
      setReady(true);
    })();
  }, [router]);

  if (!ready) return <div className="h-screen grid place-items-center text-gray-400 text-sm">Carregando…</div>;
  return <Shell>{children}</Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  useRealtime();
  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar />
      <div className="flex-1 min-w-0 flex">{children}</div>
    </div>
  );
}
