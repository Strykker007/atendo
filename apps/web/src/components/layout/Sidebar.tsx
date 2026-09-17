'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MessageSquare, Tags, BarChart3, Settings, Users, Smartphone, ChevronsLeft, ChevronsRight, LogOut, CreditCard, Loader2, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUI } from '@/lib/store';
import { api, setAccessToken } from '@/lib/api';
import { useNav } from './NavigationProgress';
import { useTheme, applyTheme } from '@/lib/theme';
import { useConversationCounts, useMe } from '@/lib/hooks';

const ADMIN_ITEM = { href: '/admin', label: 'Margem (dono)', icon: ShieldCheck };
const items = [
  { href: '/conversas', label: 'Conversas', icon: MessageSquare },
  { href: '/numeros', label: 'Números', icon: Smartphone },
  { href: '/tags', label: 'Tags', icon: Tags },
  { href: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { href: '/equipe', label: 'Equipe', icon: Users },
  { href: '/plano', label: 'Plano e uso', icon: CreditCard },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
];


/** Menu lateral: expansível ou recolhido só com ícones. Fundo escuro nos dois temas. */
export function Sidebar() {
  const path = usePathname();
  const { sidebarCollapsed: collapsed, toggleSidebar, numberId } = useUI();
  const pending = useNav((s) => s.pending);
  const mode = useTheme((s) => s.mode);
  const me = useMe();
  const counts = useConversationCounts(numberId);
  const [target, setTarget] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => { if (!pending) setTarget(null); }, [pending]);
  useEffect(() => {
    applyTheme(mode);
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => applyTheme('system');
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [mode]);

  async function logout() {
    setLeaving(true);
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    window.location.href = '/login';
  }
  const waiting = counts.data?.waiting ?? 0;

  return (
    <aside className={cn('h-full bg-side text-side-ink flex flex-col transition-[width] duration-200 border-r border-side-line', collapsed ? 'w-16' : 'w-56')}>
      <div className={cn('h-14 flex items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
        <span className="w-7 h-7 rounded-lg bg-accent grid place-items-center text-white font-display font-bold text-sm shrink-0">A</span>
        {!collapsed && <span className="font-display font-semibold text-[17px] text-white tracking-tight">Atendo</span>}
      </div>

      <nav className="flex-1 py-2">
        {[...items, ...(me.data?.role === 'super_admin' ? [ADMIN_ITEM] : [])].map(({ href, label, icon: Icon }) => {
          const active = target ? target === href : path.startsWith(href);
          const badge = href === '/conversas' && waiting > 0 ? waiting : null;
          return (
            <Link
              key={href}
              href={href}
              title={badge ? `${label} · ${badge} aguardando` : label}
              onClick={() => { if (!path.startsWith(href)) setTarget(href); }}
              className={cn(
                'relative flex items-center gap-3 mx-2 my-0.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors',
                active ? 'bg-side-on text-side-on-ink font-semibold' : 'text-side-ink hover:bg-white/5 hover:text-white',
                target === href && pending && 'animate-pulse',
                collapsed && 'justify-center px-0',
              )}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
              {badge !== null && (
                <span className={cn('tnum text-[10px] font-bold rounded-full px-1.5 min-w-[18px] text-center bg-wait text-white', collapsed ? 'absolute -top-0.5 right-1' : 'ml-auto')}>{badge}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-side-line p-2 space-y-0.5">
        {!collapsed && me.data && (
          <div className="px-3 py-1.5 text-xs">
            <div className="text-white font-medium truncate">{me.data.name}</div>
            <div className="text-side-ink/70 truncate">{me.data.role === 'agent' ? 'Atendente' : 'Administrador'}</div>
          </div>
        )}
        <button onClick={logout} disabled={leaving} title="Sair" className={cn('w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-side-ink hover:bg-white/5 hover:text-white disabled:opacity-60', collapsed && 'justify-center px-0')}>
          {leaving ? <Loader2 size={17} className="animate-spin" /> : <LogOut size={17} />} {!collapsed && (leaving ? 'Saindo…' : 'Sair')}
        </button>
        <button onClick={toggleSidebar} className="w-full flex items-center justify-center rounded-lg py-1.5 text-side-ink/60 hover:text-white" title={collapsed ? 'Expandir' : 'Recolher'}>
          {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
        </button>
      </div>
    </aside>
  );
}
