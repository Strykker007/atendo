'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MessageSquare, Zap, Tags, BarChart3, Settings, Users, Smartphone, PanelLeftClose, PanelLeftOpen, LogOut, CreditCard, Loader2, ShieldCheck, Workflow, Building2, CalendarDays, Package, Columns3, Megaphone, Send, ThumbsUp, AlarmClock, BookUser, CalendarClock, KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUI } from '@/lib/store';
import { api, setAccessToken } from '@/lib/api';
import { useNav } from './NavigationProgress';
import { CompanySwitcher } from './CompanySwitcher';
import { OwnerSwitcher } from './OwnerSwitcher';
import { ESCALAS_ABAS, primeiraAbaEscalas } from '@/components/escalas/EscalasTabs';
import { NoticeBell } from './SystemNotices';
import { MarcaIcone, MarcaMenu } from '@/components/ui/Marca';
import { useTheme, applyTheme } from '@/lib/theme';
import { useAccessRequests, useAppVersion, useConversationCounts, useMe, usePermissions, useUsage } from '@/lib/hooks';
import type { Permission, PlanFeature } from '@atendo/shared';

const OWNER_ITEMS = [
  { href: '/admin', label: 'Financeiro', icon: ShieldCheck },
  { href: '/clientes', label: 'Clientes', icon: Building2 },
  { href: '/planos', label: 'Planos', icon: Package },
  { href: '/avisos', label: 'Avisos', icon: Megaphone },
  { href: '/donos', label: 'Donos do sistema', icon: KeyRound },
];
/**
 * Regra do menu (docs/08-frontend.md#menu-lateral): item que a pessoa não pode usar não aparece.
 * Cada item espelha o que a API exige na tela dele:
 *
 * - `need`: permissão do perfil de acesso — basta UMA da lista. A API já recusava, mas o menu
 *   continuava oferecendo: a pessoa clicava e batia num 403, ou numa tela vazia que parecia defeito.
 * - `feature`: recurso do plano (`@RequireFeature` na API). Sem ele o item some, mesmo para o admin.
 *
 * Itens sem `need` são de todo mundo: conversas, Kanban (ver; mexer nas colunas é `tags.manage`),
 * respostas (consultar) e configurações (onde fica a troca da própria senha).
 */
const items: { href: string; label: string; icon: typeof MessageSquare; need?: Permission[]; feature?: PlanFeature }[] = [
  { href: '/conversas', label: 'Conversas', icon: MessageSquare },
  { href: '/kanban', label: 'Kanban', icon: Columns3 },
  { href: '/agenda', label: 'Agenda', icon: CalendarDays, need: ['agenda.manage'], feature: 'scheduling' },
  // disparar um fluxo numa conversa não depende deste item: aqui é criar/editar
  { href: '/fluxos', label: 'Fluxos', icon: Workflow, need: ['flows.manage'], feature: 'flows' },
  { href: '/respostas', label: 'Respostas', icon: Zap },
  // quem agenda (permissão vendida à parte) ou quem supervisiona a equipe (gerente padrão vê as
  // de todos sem poder agendar). Sem nenhuma das duas, a lista seria só das próprias — que não existem
  { href: '/agendadas', label: 'Mensagens agendadas', icon: AlarmClock, need: ['conversations.schedule_message', 'conversations.view_all'] },
  { href: '/tags', label: 'Tags', icon: Tags, need: ['tags.manage'] },
  { href: '/contatos', label: 'Contatos', icon: BookUser, need: ['contacts.import_export'] },
  { href: '/transmissoes', label: 'Transmissões', icon: Send, need: ['campaigns.manage'], feature: 'campaigns' },
  { href: '/pesquisas', label: 'Pesquisas', icon: ThumbsUp, need: ['settings.manage'], feature: 'satisfaction_surveys' },
  { href: '/relatorios', label: 'Relatórios', icon: BarChart3, need: ['reports.view'] },
  { href: '/equipe', label: 'Equipe', icon: Users, need: ['team.manage'] },
  // tudo que é horário (plantões, escalas, horário de atendimento): o destino é a 1ª aba permitida
  { href: '/escalas', label: 'Escalas e plantões', icon: CalendarClock, need: ESCALAS_ABAS.map((a) => a.need) },
  { href: '/plano', label: 'Plano e uso', icon: CreditCard, need: ['billing.manage'] },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
];


/** Menu lateral: expansível ou recolhido só com ícones. Fundo escuro nos dois temas. */
export function Sidebar() {
  const path = usePathname();
  const { sidebarCollapsed: collapsed, toggleSidebar, numberId } = useUI();
  const versao = useAppVersion();
  const pending = useNav((s) => s.pending);
  const mode = useTheme((s) => s.mode);
  const me = useMe();
  const counts = useConversationCounts(numberId);
  const minhas = usePermissions();
  const permitido = (p: Permission) => minhas.includes(p);
  const usage = useUsage();
  // enquanto o plano carrega, o item aparece (sumir e voltar pisca o menu)
  const noPlano = (f: PlanFeature) => !usage.data || !!usage.data.limits?.features?.includes(f);
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
  /**
   * Menu: o do cliente (a empresa do dono, ou a que ele está vendo) + a seção de dono para quem é
   * dono do sistema (docs/donos-do-sistema.md). Dono sem empresa e fora de cliente: só a seção
   * de dono e Configurações, como antes.
   */
  const doCliente = items
    .filter((i) => (!i.need || i.need.some(permitido)) && (!i.feature || noPlano(i.feature)))
    .map((i) => (i.href === '/escalas' ? { ...i, href: primeiraAbaEscalas(minhas) ?? i.href } : i));
  const semCliente = !me.data?.tenantId;
  const menu: { href: string; label: string; icon: typeof MessageSquare; secao?: string }[] = !me.data?.systemOwner
    ? doCliente
    : semCliente
      ? [...OWNER_ITEMS, items[items.length - 1]]
      : [...doCliente, ...OWNER_ITEMS.map((i, n) => (n === 0 ? { ...i, secao: 'Dono do sistema' } : i))];
  const waiting = counts.data?.waiting ?? 0;
  // pedidos de autorização de plantão esperando resposta (docs/escalas.md#pedido-de-autorização)
  const pedidos = useAccessRequests(me.data?.role !== 'super_admin' && permitido('team.manage')).data?.length ?? 0;

  return (
    <aside className={cn('h-full bg-side text-side-ink flex flex-col transition-[width] duration-200 border-r border-side-line', collapsed ? 'w-14' : 'w-52')}>
      {/* recolher fica no topo, ao lado da marca: no rodapé ficava perdido no meio da gaveta
          e as pessoas não achavam */}
      <div className={cn('h-12 flex items-center gap-2.5 px-3.5', collapsed && 'justify-center px-0')}>
        {/* o menu tem fundo escuro: a logo do menu é a versão com texto claro. Recolhido fica só o símbolo. */}
        {collapsed ? (
          <MarcaIcone className="h-7 w-auto shrink-0" />
        ) : (
          <>
            <MarcaMenu className="h-6 w-auto flex-1 min-w-0 object-contain object-left" />
            {/* avisos globais do sistema: não há barra superior, então o sino mora no topo do menu */}
            <NoticeBell />
            <button onClick={toggleSidebar} className="p-1 -mr-1 rounded-md text-side-ink/60 hover:text-white hover:bg-white/5" title="Recolher menu">
              <PanelLeftClose size={17} />
            </button>
          </>
        )}
      </div>
      {collapsed && (
        <>
          <button onClick={toggleSidebar} className="mx-auto mb-1 p-1 rounded-md text-side-ink/60 hover:text-white hover:bg-white/5" title="Expandir menu">
            <PanelLeftOpen size={17} />
          </button>
          <NoticeBell className="mx-auto mb-1" />
        </>
      )}
      {/* empresa/unidade ativa: some quando o cliente não usa empresas */}
      {/* dono: entra em qualquer cliente pelo menu (docs/donos-do-sistema.md#ver-cliente) */}
      {me.data?.systemOwner && <OwnerSwitcher collapsed={collapsed} />}
      {me.data?.role !== 'super_admin' && <CompanySwitcher collapsed={collapsed} />}

      <nav className="flex-1 py-2">
        {menu.map(({ href, label, icon: Icon, secao }) => {
          // as abas de Escalas e plantões contam como o mesmo item
          const raiz = href.startsWith('/escalas/') ? '/escalas' : href;
          const active = target ? target === href : path.startsWith(raiz);
          const badge = href === '/conversas' && waiting > 0 ? waiting : raiz === '/escalas' && pedidos > 0 ? pedidos : null;
          return (
            <div key={href}>
            {secao && (collapsed
              ? <div className="mx-3 my-1.5 border-t border-side-line" />
              : <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-side-ink/50">{secao}</div>)}
            <Link
              href={href}
              title={badge ? `${label} · ${badge} aguardando` : label}
              onClick={() => { if (!path.startsWith(raiz)) setTarget(href); }}
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
            </div>
          );
        })}
      </nav>

      <div className="border-t border-side-line p-2 space-y-0.5">
        {!collapsed && me.data && (
          <div className="px-3 py-1.5 text-xs">
            <div className="text-white font-medium truncate">{me.data.name}</div>
            <div className="text-side-ink/70 truncate">{{ agent: 'Atendente', manager: 'Gerente', tenant_admin: me.data.impersonatorId ? 'Dono · dentro do cliente' : 'Administrador', super_admin: 'Dono do sistema' }[me.data.role]}{me.data.systemOwner && !me.data.impersonatorId && me.data.role !== 'super_admin' ? ' · dono do sistema' : ''}</div>
          </div>
        )}
        <button onClick={logout} disabled={leaving} title="Sair" className={cn('w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-side-ink hover:bg-white/5 hover:text-white disabled:opacity-60', collapsed && 'justify-center px-0')}>
          {leaving ? <Loader2 size={17} className="animate-spin" /> : <LogOut size={17} />} {!collapsed && (leaving ? 'Saindo…' : 'Sair')}
        </button>
        {/* versão no ar: quando alguém relata um problema, é a primeira coisa a perguntar */}
        {versao.data && (
          <div title={versao.data.full} className={cn('px-3 pt-1 text-[10px] text-side-ink/50 tnum select-all', collapsed && 'px-0 text-center')}>
            {collapsed ? versao.data.short : `Versão ${versao.data.short}`}
          </div>
        )}
      </div>
    </aside>
  );
}
