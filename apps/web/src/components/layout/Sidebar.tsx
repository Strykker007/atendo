'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MessageSquare, Zap, Tags, BarChart3, Settings, Users, Smartphone, PanelLeftClose, PanelLeftOpen, LogOut, CreditCard, Loader2, ShieldCheck, Workflow, Building2, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUI } from '@/lib/store';
import { api, setAccessToken } from '@/lib/api';
import { useNav } from './NavigationProgress';
import { useTheme, applyTheme } from '@/lib/theme';
import { useConversationCounts, useMe } from '@/lib/hooks';

const OWNER_ITEMS = [
  { href: '/admin', label: 'Financeiro', icon: ShieldCheck },
  { href: '/clientes', label: 'Clientes', icon: Building2 },
];
const items = [
  { href: '/conversas', label: 'Conversas', icon: MessageSquare },
  { href: '/numeros', label: 'Números', icon: Smartphone },
  { href: '/agenda', label: 'Agenda', icon: CalendarDays },
  { href: '/fluxos', label: 'Fluxos', icon: Workflow },
  { href: '/respostas', label: 'Respostas', icon: Zap },
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
    <aside className={cn('h-full bg-side text-side-ink flex flex-col transition-[width] duration-200 border-r border-side-line', collapsed ? 'w-14' : 'w-52')}>
      {/* recolher fica no topo, ao lado da marca: no rodapé ficava perdido no meio da gaveta
          e as pessoas não achavam */}
      <div className={cn('h-12 flex items-center gap-2.5 px-3.5', collapsed && 'justify-center px-0')}>
        {/* a logo é escura no original e o menu tem fundo escuro: a versão `-escuro` tem o
            texto em branco e mantém o vermelho da marca. Recolhido fica só o robô. */}
        {collapsed ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src="/marca/vogo-icone.png" alt="VOGO.CHAT" className="h-7 w-auto shrink-0" />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marca/vogo-escuro.png" alt="VOGO.CHAT" className="h-6 w-auto flex-1 object-contain object-left" />
            <button onClick={toggleSidebar} className="p-1 -mr-1 rounded-md text-side-ink/60 hover:text-white hover:bg-white/5" title="Recolher menu">
              <PanelLeftClose size={17} />
            </button>
          </>
        )}
      </div>
      {collapsed && (
        <button onClick={toggleSidebar} className="mx-auto mb-1 p-1 rounded-md text-side-ink/60 hover:text-white hover:bg-white/5" title="Expandir menu">
          <PanelLeftOpen size={17} />
        </button>
      )}

      <nav className="flex-1 py-2">
        {(me.data?.role === 'super_admin' ? [...OWNER_ITEMS, items[items.length - 1]] : items).map(({ href, label, icon: Icon }) => {
          const active = target ? target === href : path.startsWith(href);
          const badge = href === '/conversas' && waiting > 0 ? waiting : null;
          return (
            <Link
              key={href}
              href={href}
              title={badge ? `${label} · ${badge} aguardando` : label}
              onClick={() => { if (!path.startsWith(href)) setTarget(href); }}
              className={cn(
                'relative flex items-center gap-2.5 mx-2 my-px rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                active ? 'bg-side-on text-side-on-ink font-semibold' : 'text-side-ink hover:bg-white/5 hover:text-white',
                target === href && pending && 'animate-pulse',
                collapsed && 'justify-center px-0',
              )}
            >
              <Icon size={17} className="shrink-0" />
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
            <div className="text-side-ink/70 truncate">{{ agent: 'Atendente', manager: 'Gerente', tenant_admin: me.data.impersonatorId ? 'Dono · dentro do cliente' : 'Administrador', super_admin: 'Dono do sistema' }[me.data.role]}</div>
          </div>
        )}
        <button onClick={logout} disabled={leaving} title="Sair" className={cn('w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-side-ink hover:bg-white/5 hover:text-white disabled:opacity-60', collapsed && 'justify-center px-0')}>
          {leaving ? <Loader2 size={17} className="animate-spin" /> : <LogOut size={17} />} {!collapsed && (leaving ? 'Saindo…' : 'Sair')}
        </button>
      </div>
    </aside>
  );
}
