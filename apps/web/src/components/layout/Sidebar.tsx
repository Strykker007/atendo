'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, Tags, BarChart3, Settings, Users, Smartphone, ChevronsLeft, ChevronsRight, LogOut, CreditCard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUI } from '@/lib/store';
import { api, setAccessToken } from '@/lib/api';
import { useNav } from './NavigationProgress';
import { useEffect, useState } from 'react';

const items = [
  { href: '/conversas', label: 'Conversas', icon: MessageSquare },
  { href: '/numeros', label: 'Números', icon: Smartphone },
  { href: '/tags', label: 'Tags', icon: Tags },
  { href: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { href: '/equipe', label: 'Equipe', icon: Users },
  { href: '/plano', label: 'Plano e uso', icon: CreditCard },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
];

/** Menu lateral: expansível ou recolhido só com ícones. */
export function Sidebar() {
  const path = usePathname();
  const { sidebarCollapsed: collapsed, toggleSidebar } = useUI();
  const pending = useNav((s) => s.pending);
  // destino clicado: destaca imediatamente, mesmo antes de a rota carregar
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => { if (!pending) setTarget(null); }, [pending]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    window.location.href = '/login';
  }

  return (
    <aside className={cn('h-full bg-white border-r border-surface-border flex flex-col transition-[width] duration-200', collapsed ? 'w-16' : 'w-56')}>
      <div className={cn('h-14 flex items-center border-b border-surface-border px-4', collapsed && 'justify-center px-0')}>
        <span className="text-brand font-semibold text-lg">{collapsed ? 'A' : 'Atendo'}</span>
      </div>
      <nav className="flex-1 py-2">
        {items.map(({ href, label, icon: Icon }) => {
          const active = target ? target === href : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              onClick={() => { if (!path.startsWith(href)) setTarget(href); }}
              className={cn(
                'flex items-center gap-3 mx-2 my-0.5 rounded-lg px-3 py-2 text-sm transition-colors',
                active ? 'bg-brand-soft text-brand font-medium' : 'text-gray-600 hover:bg-surface-muted active:bg-surface-border',
                target === href && pending && 'animate-pulse',
                collapsed && 'justify-center px-0',
              )}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-surface-border p-2 space-y-1">
        <button onClick={logout} title="Sair" className={cn('w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-surface-muted', collapsed && 'justify-center px-0')}>
          <LogOut size={18} /> {!collapsed && 'Sair'}
        </button>
        <button onClick={toggleSidebar} className="w-full flex items-center justify-center rounded-lg py-2 text-gray-400 hover:bg-surface-muted" title={collapsed ? 'Expandir' : 'Recolher'}>
          {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        </button>
      </div>
    </aside>
  );
}
