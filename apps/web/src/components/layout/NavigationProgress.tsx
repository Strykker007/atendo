'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { create } from 'zustand';

/**
 * Barra fina no topo enquanto uma navegação está em andamento.
 * Começa no clique em qualquer link interno (antes de a rota compilar/carregar)
 * e termina quando o pathname muda. Assim o usuário vê resposta imediata.
 */
export const useNav = create<{ pending: boolean; start: () => void; stop: () => void }>((set) => ({
  pending: false,
  start: () => set({ pending: true }),
  stop: () => set({ pending: false }),
}));

export function NavigationProgress() {
  const pathname = usePathname();
  const { pending, start, stop } = useNav();
  const [width, setWidth] = useState(0);

  // termina quando a rota efetivamente mudou
  useEffect(() => { stop(); }, [pathname, stop]);

  // captura cliques em links internos (Sidebar e qualquer <a href="/...">)
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname) return;
      start();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [start]);

  // animação: avança rápido até ~80% e espera; ao terminar vai a 100% e some
  useEffect(() => {
    if (!pending) {
      if (width > 0) { setWidth(100); const t = setTimeout(() => setWidth(0), 250); return () => clearTimeout(t); }
      return;
    }
    setWidth(15);
    const t = setInterval(() => setWidth((w) => (w < 80 ? w + (80 - w) * 0.15 : w)), 120);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (width === 0) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[70] h-0.5 pointer-events-none">
      <div className="h-full bg-accent shadow-[0_0_8px_rgba(22,163,74,.6)] transition-[width] duration-150 ease-out" style={{ width: `${width}%` }} />
    </div>
  );
}
