'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { api, getAccessToken, setAccessToken } from '@/lib/api';
import { useRealtime } from '@/lib/hooks';
import { UsageBanner } from '@/components/layout/UsageBanner';
import { WaRemovedBanner } from '@/components/numbers/WaRemovedNotice';
import { Toaster } from '@/components/ui/Toast';
import { NavigationProgress } from '@/components/layout/NavigationProgress';
import { ImpersonationBanner } from '@/components/layout/ImpersonationBanner';
import { VersionWatcher } from '@/components/layout/VersionWatcher';
import { NoticePopups } from '@/components/layout/SystemNotices';

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
      // dono do sistema entra direto no Financeiro
      try {
        const me = await api<{ role: string }>('/auth/me');
        if (me.role === 'super_admin' && (location.pathname === '/conversas' || location.pathname === '/')) router.replace('/admin');
      } catch { /* segue */ }
      setReady(true);
    })();
  }, [router]);

  if (!ready) return (
    <div className="h-screen grid place-items-center">
      <div className="flex flex-col items-center gap-3 text-faint text-sm">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        Entrando…
      </div>
    </div>
  );
  return <Shell>{children}</Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  useRealtime();
  const pathname = usePathname();
  return (
    <div className="h-screen flex overflow-hidden">
      <NavigationProgress />
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <ImpersonationBanner />
        <UsageBanner />
        <WaRemovedBanner />
        <div key={pathname} className="flex-1 min-h-0 flex animate-fade-in">{children}</div>
      </div>
      <Toaster />
      <NoticePopups />
      <VersionWatcher />
    </div>
  );
}
