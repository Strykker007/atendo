'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MessageSquare, Ticket, Zap, BarChart3, Settings, Users, Smartphone, PanelLeftClose, PanelLeftOpen, LogOut, Loader2, ChevronDown, ShieldCheck, Workflow, Building2, CalendarDays, Package, Columns3, Megaphone, Send, AlarmClock, BookUser, Tags, CalendarClock, KeyRound, Handshake, LayoutDashboard, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUI } from '@/lib/store';
import { api, setAccessToken } from '@/lib/api';
import { useNav } from './NavigationProgress';
import { CompanySwitcher } from './CompanySwitcher';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { ESCALAS_ABAS, primeiraAbaEscalas } from '@/components/escalas/EscalasTabs';
import { SECTION_TABS, useTabFilter, type SectionKey, type SectionTab } from './SectionTabs';
import { NoticeBell } from './SystemNotices';
import { PauseControl } from '@/components/queue/Queue';
import { MarcaIcone, MarcaMenu } from '@/components/ui/Marca';
import { useTheme, applyTheme } from '@/lib/theme';
import { useAccessRequests, useAppVersion, useConversationCounts, useMe, usePermissions, useTicketsSummary, useUsage } from '@/lib/hooks';
import type { Permission, PlanFeature } from '@atendo/shared';

const OWNER_ITEMS = [
  { href: '/admin', label: 'Financeiro', icon: ShieldCheck },
  { href: '/clientes', label: 'Clientes', icon: Building2 },
  { href: '/parceiros', label: 'Parceiros', icon: Handshake },
  { href: '/planos', label: 'Planos', icon: Package },
  { href: '/avisos', label: 'Avisos', icon: Megaphone },
  { href: '/donos', label: 'Donos do sistema', icon: KeyRound },
];
/** Portal do VogoPartner (docs/37-vogopartners.md): só os clientes e o dinheiro dele. */
const PARTNER_ITEMS = [
  { href: '/parceiro', label: 'Painel', icon: LayoutDashboard },
  { href: '/parceiro/clientes', label: 'Meus clientes', icon: Building2 },
  { href: '/parceiro/extrato', label: 'Extrato', icon: Receipt },
];
/**
 * Regra do menu (docs/08-frontend.md#menu-lateral): item que a pessoa não pode usar não aparece.
 * Cada item espelha o que a API exige na tela dele:
 *
 * - `need`: permissão do perfil de acesso — basta UMA da lista. A API já recusava, mas o menu
 *   continuava oferecendo: a pessoa clicava e batia num 403, ou numa tela vazia que parecia defeito.
 * - `feature`: recurso do plano (`@RequireFeature` na API). Sem ele o item some, mesmo para o admin.
 * - `tabs`: telas parecidas que dividem o item (`SECTION_TABS`, com abas no topo de cada uma). O
 *   item aparece se alguma aba for permitida e leva à primeira delas.
 *
 * Itens sem `need` são de todo mundo: conversas, Kanban (ver; mexer nas colunas é `tags.manage`),
 * respostas (consultar) e configurações (onde fica a troca da própria senha).
 */
type NavItem = { href: string; label: string; icon: typeof MessageSquare; need?: Permission[]; feature?: PlanFeature; tabs?: SectionKey };
/** Grupos que abrem e fecham; `id` null = sem título (portal do parceiro, dono fora de cliente). */
const GROUPS: { id: string | null; label: string; items: NavItem[] }[] = [
  {
    id: 'atendimento', label: 'Atendimento', items: [
      { href: '/conversas', label: 'Conversas', icon: MessageSquare },
      { href: '/kanban', label: 'Kanban', icon: Columns3 },
      // tickets internos entre setores (docs/tickets.md)
      { href: '/tickets', label: 'Tickets', icon: Ticket, need: ['tickets.create', 'tickets.handle', 'tickets.view_all', 'tickets.manage'], feature: 'tickets' },
      { href: '/agenda', label: 'Agenda', icon: CalendarDays, need: ['agenda.manage'], feature: 'scheduling' },
      // quem agenda (permissão vendida à parte) ou quem supervisiona a equipe (gerente padrão vê as
      // de todos sem poder agendar). Sem nenhuma das duas, a lista seria só das próprias — que não existem
      { href: '/agendadas', label: 'Mensagens agendadas', icon: AlarmClock, need: ['conversations.schedule_message', 'conversations.view_all'] },
      { href: '/contatos', label: 'Contatos', icon: BookUser },
      { href: '/tags', label: 'Tags', icon: Tags, need: ['tags.manage'] },
    ],
  },
  {
    id: 'automacao', label: 'Automação', items: [
      // disparar um fluxo numa conversa não depende deste item: aqui é criar/editar (aba Agentes de IA)
      { href: '/fluxos', label: 'Fluxos', icon: Workflow, tabs: 'fluxos' },
      { href: '/respostas', label: 'Respostas', icon: Zap },
      { href: '/transmissoes', label: 'Transmissões', icon: Send, need: ['campaigns.manage'], feature: 'campaigns' },
    ],
  },
  {
    id: 'gestao', label: 'Gestão', items: [
      { href: '/relatorios', label: 'Relatórios', icon: BarChart3, tabs: 'relatorios' },
      { href: '/equipe', label: 'Equipe', icon: Users, need: ['team.manage'] },
      // tudo que é horário (plantões, escalas, horário de atendimento): o destino é a 1ª aba permitida
      { href: '/escalas', label: 'Escalas e plantões', icon: CalendarClock, need: ESCALAS_ABAS.map((a) => a.need) },
    ],
  },
  // Plano e uso virou aba de Configurações; Conta fica sempre por último (depois até do grupo de dono)
  { id: 'conta', label: 'Conta', items: [{ href: '/configuracoes', label: 'Configurações', icon: Settings, tabs: 'configuracoes' }] },
];
const CONFIG_ITEM = GROUPS[GROUPS.length - 1].items[0];
/** Rotas que acendem o item: a dele, as abas dele e as subpáginas. */
const rotasDo = (i: NavItem) => (i.tabs ? (SECTION_TABS[i.tabs] as SectionTab[]).map((t) => t.href) : [i.href.startsWith('/escalas') ? '/escalas' : i.href]);
const naRota = (path: string, r: string) => path === r || path.startsWith(`${r}/`);


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
  const abaPermitida = useTabFilter();
  const pode = (i: NavItem) => (!i.need || i.need.some(permitido)) && (!i.feature || noPlano(i.feature));
  /** item visível com o destino já resolvido (1ª aba permitida); null = some */
  const resolver = (i: NavItem): NavItem | null => {
    if (i.tabs) {
      const abas = (SECTION_TABS[i.tabs] as SectionTab[]).filter(abaPermitida);
      return abas.length ? { ...i, href: abas[0].href } : null;
    }
    if (!pode(i)) return null;
    return i.href === '/escalas' ? { ...i, href: primeiraAbaEscalas(minhas) ?? i.href } : i;
  };
  const doCliente = GROUPS.map((g) => ({ ...g, items: g.items.map(resolver).filter((i): i is NavItem => !!i) })).filter((g) => g.items.length);
  const semCliente = !me.data?.tenantId;
  const parceiro = me.data?.role === 'partner';
  const dono = { id: 'dono', label: 'Dono do sistema', items: OWNER_ITEMS as NavItem[] };
  const grupos: { id: string | null; label: string; items: NavItem[] }[] = parceiro
    ? [{ id: null, label: '', items: PARTNER_ITEMS as NavItem[] }]
    : !me.data?.systemOwner
    ? doCliente
    : semCliente
      ? [{ ...dono, id: null, label: '' }, { id: 'conta', label: 'Conta', items: [{ ...CONFIG_ITEM, tabs: undefined }] }]
      : [...doCliente.filter((g) => g.id !== 'conta'), dono, ...doCliente.filter((g) => g.id === 'conta')];
  const closed = useUI((s) => s.closedNavGroups);
  const toggleGroup = useUI((s) => s.toggleNavGroup);
  const waiting = counts.data?.waiting ?? 0;
  // pedidos de autorização de plantão esperando resposta (docs/escalas.md#pedido-de-autorização)
  const pedidos = useAccessRequests(me.data?.role !== 'super_admin' && permitido('team.manage')).data?.length ?? 0;
  // o Painel do parceiro é prefixo das outras telas dele: só ativo na própria rota
  const estaAtivo = (i: NavItem) => (target ? target === i.href : i.href === '/parceiro' ? path === i.href : rotasDo(i).some((r) => naRota(path, r)));
  // tickets sem responsável no meu setor (aberto pelo fluxo, pela portaria…): alguém precisa pegar (docs/tickets.md#no-painel)
  const tickets = useTicketsSummary(me.data?.role !== 'super_admin' && !!usage.data?.limits?.features?.includes('tickets') && (['tickets.handle', 'tickets.manage'] as Permission[]).some(permitido)).data?.toPick ?? 0;
  const badgeDe = (i: NavItem) => (i.href === '/conversas' && waiting > 0 ? waiting : i.href.startsWith('/escalas') && pedidos > 0 ? pedidos : i.href === '/tickets' && tickets > 0 ? tickets : null);

  return (
    <aside className={cn('h-full bg-side text-side-ink flex flex-col transition-[width] duration-200 border-r border-side-line', collapsed ? 'w-14' : 'w-52')}>
      {/* recolher fica no topo, ao lado da marca: no rodapé ficava perdido no meio da gaveta
          e as pessoas não achavam */}
      <div className={cn('h-12 shrink-0 flex items-center gap-2.5 px-3.5', collapsed && 'justify-center px-0')}>
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
      {/* minhas empresas + (dono) qualquer cliente — Ctrl+K (docs/multiempresa.md#seletor) */}
      {/* parceiro também: quem é dono de farmácia E VogoPartner troca entre os dois (docs/37-vogopartners.md) */}
      <WorkspaceSwitcher collapsed={collapsed} owner={!parceiro && !!me.data?.systemOwner} />
      {me.data?.role !== 'super_admin' && !parceiro && <CompanySwitcher collapsed={collapsed} />}

      {/* só o menu rola: em tela baixa (notebook, zoom) os itens de baixo ficavam inalcançáveis,
          e marca, seletores e rodapé (Sair, versão) continuam sempre à vista */}
      <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin [scrollbar-width:thin] py-2">
        {grupos.map((g, gi) => {
          const ativoAqui = g.items.some((i) => estaAtivo(i));
          const aberto = collapsed || !g.id || !closed.includes(g.id);
          const badgeGrupo = g.items.reduce((n, i) => n + (badgeDe(i) ?? 0), 0);
          return (
            <div key={g.id ?? `g${gi}`}>
              {g.id && (collapsed
                ? gi > 0 && <div className="mx-3 my-1.5 border-t border-side-line" />
                : (
                  <button type="button" onClick={() => toggleGroup(g.id!)} aria-expanded={aberto} title={aberto ? `Fechar ${g.label}` : `Abrir ${g.label}`}
                    className={cn('group/sec w-[calc(100%-1rem)] mx-2 mt-2 mb-0.5 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors hover:bg-white/5 hover:text-white', !aberto && ativoAqui ? 'text-white' : 'text-side-ink/85')}>
                    {/* seta à esquerda, como em árvore de pastas: deixa claro que abre e fecha */}
                    <ChevronDown size={14} className={cn('shrink-0 text-side-ink/70 group-hover/sec:text-white transition-transform', !aberto && '-rotate-90')} />
                    <span className="flex-1 text-left">{g.label}</span>
                    {!aberto && badgeGrupo > 0 && <span className="tnum text-[10px] font-bold rounded-full px-1.5 min-w-[18px] text-center bg-wait text-white normal-case tracking-normal">{badgeGrupo}</span>}
                    {!aberto && <span className="text-[10px] font-medium normal-case tracking-normal text-side-ink/60">{g.items.length}</span>}
                  </button>
                ))}
              {!g.id && gi > 0 && <div className={cn('border-t border-side-line', collapsed ? 'mx-3 my-1.5' : 'mx-4 mt-2 mb-1')} />}
              {aberto && g.items.map((item) => {
                const { href, label, icon: Icon } = item;
                const active = estaAtivo(item);
                const badge = badgeDe(item);
                return (
                  <Link
                    key={href}
                    href={href}
                    title={badge ? `${label} · ${badge} aguardando` : label}
                    onClick={() => { if (!rotasDo(item).some((r) => naRota(path, r))) setTarget(href); }}
                    className={cn(
                      'relative flex items-center gap-2.5 my-px rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                      // dentro de um grupo com título: recuo, para ler como item do grupo
                      g.id && !collapsed ? 'ml-5 mr-2' : 'mx-2',
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
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-side-line p-2 space-y-0.5">
        {!collapsed && me.data && (
          <div className="px-3 py-1.5 text-xs">
            <div className="text-white font-medium truncate">{me.data.name}</div>
            <div className="text-side-ink/70 truncate">{{ agent: 'Atendente', manager: 'Gerente', tenant_admin: me.data.impersonatorId ? (me.data.partnerId ? 'Parceiro · dentro do cliente' : 'Dono · dentro do cliente') : 'Administrador', super_admin: 'Dono do sistema', partner: 'VogoPartner' }[me.data.role]}{me.data.systemOwner && !me.data.impersonatorId && me.data.role !== 'super_admin' ? ' · dono do sistema' : ''}</div>
          </div>
        )}
        {/* disponível / em pausa (docs/fila-de-atendimento.md#pausa) */}
        <PauseControl collapsed={collapsed} />
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
