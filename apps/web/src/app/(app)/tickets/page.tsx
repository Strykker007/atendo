'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ticket, Plus, Search, X, Bot, Workflow, Shapes, PauseCircle, PlayCircle, ArrowRightLeft, CheckCircle2, RotateCcw, Ban, UserPlus, UserMinus, Send, MessageSquare, Settings2, Trash2, Hand, BarChart3, List, Columns3, Pencil, BellRing, UserRound } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL, TICKET_SOURCE_LABEL, TICKET_STATUS_LABEL, TICKET_TEXT_MAX, TICKET_TITLE_MAX, type TicketPriority, type TicketSource, type TicketStatus } from '@atendo/shared';
import { CamposDoTipo, TipoChip, TiposModal, ValoresDoTicket } from '@/components/tickets/TicketTypes';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { DateInput } from '@/components/ui/DatePicker';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { useUI } from '@/lib/store';
import { NewTicketModal, hojeYmd, fimDoDia } from '@/components/tickets/NewTicketModal';
import { AvisosModal, EncerrarModal, ReclamantePicker, nomeDoReclamante } from '@/components/tickets/Requester';
import { useCan, useMe, useTicket, useTicketBulk, useTicketOptions, useTickets, useTicketsSummary, useTicketWrite, type TicketBulkInput, type TicketDetail, type TicketEvent, type TicketOptions, type TicketQuery, type TicketRow } from '@/lib/hooks';

const STATUS_CLS: Record<TicketStatus, string> = {
  open: 'bg-accent-soft text-accent-ink',
  in_progress: 'bg-ok-soft text-ok',
  on_hold: 'bg-warn-soft text-warn-ink',
  resolved: 'bg-field text-muted',
  canceled: 'bg-field text-faint line-through',
};
const PRIO_CLS: Record<TicketPriority, string> = { low: 'text-faint', normal: 'text-muted', high: 'text-warn-ink font-semibold', urgent: 'text-danger-ink font-semibold' };
const selCls = cn(inputCls, 'h-9 py-0 w-auto');
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

/** Selo de origem para o que não foi aberto por uma pessoa no painel. */
function Origem({ source }: { source: TicketSource }) {
  if (source !== 'flow' && source !== 'agent') return null;
  const Icon = source === 'flow' ? Workflow : Bot;
  return <span className="inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 bg-field text-muted whitespace-nowrap" title={`Aberto pelo ${TICKET_SOURCE_LABEL[source].toLowerCase()}`}><Icon size={11} /> {source === 'flow' ? 'fluxo' : 'IA'}</span>;
}

function Chip({ status }: { status: TicketStatus }) {
  return <span className={cn('text-[11px] rounded-full px-2 py-0.5 whitespace-nowrap', STATUS_CLS[status])}>{TICKET_STATUS_LABEL[status]}</span>;
}

type Visao = 'mine' | 'department' | 'to_pick' | 'overdue' | 'today' | 'created' | 'all';
type Modo = 'lista' | 'quadro';
type Resumo = NonNullable<ReturnType<typeof useTicketsSummary>['data']>;
/** Filas prontas: cada uma é um recorte de `scope`/`due`/`status`, com a contagem do resumo. */
const VISOES: { id: Visao; label: string; q: Partial<TicketQuery>; n?: (r: Resumo) => number; tom?: 'danger' | 'warn' }[] = [
  { id: 'mine', label: 'Comigo', q: { scope: 'mine', due: '', status: 'active' }, n: (r) => r.mine },
  { id: 'department', label: 'Do meu setor', q: { scope: 'department', due: '', status: 'active' }, n: (r) => r.department },
  { id: 'to_pick', label: 'Sem responsável', q: { scope: 'to_pick', due: '', status: 'open' }, n: (r) => r.toPick },
  { id: 'overdue', label: 'Atrasados', q: { scope: 'all', due: 'overdue', status: 'active' }, n: (r) => r.overdue, tom: 'danger' },
  { id: 'today', label: 'Vencem hoje', q: { scope: 'all', due: 'today', status: 'active' }, n: (r) => r.dueToday, tom: 'warn' },
  { id: 'created', label: 'Que abri', q: { scope: 'created', due: '', status: 'active' } },
  { id: 'all', label: 'Todos', q: { scope: 'all', due: '', status: 'active' } },
];
/** colunas do quadro: cancelado fica de fora (é o "lixo" do fluxo, fica na lista) */
const COLUNAS: TicketStatus[] = ['open', 'in_progress', 'on_hold', 'resolved'];
const ORDENS: [NonNullable<TicketQuery['sort']>, string][] = [['updated', 'Última mudança'], ['due', 'Prazo mais perto'], ['priority', 'Prioridade'], ['created', 'Mais novos']];
const ymdSP = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Selo de prazo: só para o que ainda depende da equipe (aberto/em andamento). */
function Prazo({ t }: { t: TicketRow }) {
  if (!t.dueAt || !['open', 'in_progress'].includes(t.status)) return null;
  const due = new Date(t.dueAt);
  const agora = Date.now();
  if (due.getTime() < agora) {
    const dias = Math.floor((agora - due.getTime()) / 86_400_000);
    return <span className="text-[11px] rounded-full px-2 py-0.5 bg-danger-soft text-danger-ink whitespace-nowrap">{dias >= 1 ? `atrasado ${dias}d` : 'atrasado'}</span>;
  }
  if (ymdSP(t.dueAt) === hojeYmd()) return <span className="text-[11px] rounded-full px-2 py-0.5 bg-warn-soft text-warn-ink whitespace-nowrap">vence hoje</span>;
  return null;
}

/**
 * Tickets internos (docs/tickets.md): um setor pede algo a outro. Filas prontas (comigo, sem
 * responsável, atrasados…), lista com ações em massa ou quadro por situação (arrastar muda a
 * situação), e o detalhe com edição. Relatório em /relatorios/tickets.
 */
export default function TicketsPage() {
  const podeAbrir = useCan('tickets.create');
  const atende = useCan('tickets.handle');
  const verTodos = useCan('tickets.view_all');
  const gestao = useCan('tickets.manage');
  const verRelatorio = useCan('reports.view') || verTodos || gestao;
  const resumo = useTicketsSummary();
  const [visao, setVisao] = useState<Visao>('mine');
  const [q, setQ] = useState<TicketQuery>({ scope: 'mine', status: 'active', page: 1, sort: 'updated' });
  const set = (p: Partial<TicketQuery>) => setQ((x) => ({ ...x, page: 1, ...p }));
  const [modo, setModo] = useState<Modo>('lista');
  // lista × quadro é preferência de quem usa: lembra no navegador (sem ele, lista)
  useEffect(() => { try { if (localStorage.getItem('tickets.modo') === 'quadro') setModo('quadro'); } catch { /* sem armazenamento */ } }, []);
  const trocarModo = (m: Modo) => { setModo(m); try { localStorage.setItem('tickets.modo', m); } catch { /* sem armazenamento */ } };
  const lista = useTickets(q, modo === 'lista');
  const opts = useTicketOptions();
  const [aberto, setAberto] = useState<string | null>(null);
  // /tickets?ver=<id>: vindo do selo ou do marco na conversa, já abre o ticket
  useEffect(() => {
    const ver = new URLSearchParams(window.location.search).get('ver');
    if (ver) setAberto(ver);
  }, []);
  const [novo, setNovo] = useState(false);
  const [motivos, setMotivos] = useState(false);
  const [tipos, setTipos] = useState(false);
  const [avisos, setAvisos] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  // filtro mudou: a seleção era de outra lista
  useEffect(() => setSel([]), [q, modo]);
  const r = resumo.data;

  const visoes = VISOES.filter((v) => v.id !== 'department' || atende).filter((v) => v.id !== 'to_pick' || atende || gestao).filter((v) => v.id !== 'all' || verTodos || gestao);
  const escolher = (v: (typeof VISOES)[number]) => { setVisao(v.id); set(v.q); };
  const itens = lista.data?.items ?? [];
  const todosMarcados = itens.length > 0 && itens.every((t) => sel.includes(t.id));

  return (
    <PageShell width="max-w-6xl">
      <PageHeader
        title="Tickets"
        subtitle="Pedidos entre setores: quem abre, quem atua junto, o que está esperando algo de fora."
        action={<div className="flex flex-wrap gap-2">
          {verRelatorio && <Link href="/relatorios/tickets" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-medium text-ink hover:bg-field"><BarChart3 size={15} /> Relatório</Link>}
          {gestao && <Button variant="ghost" icon={<Shapes size={15} />} onClick={() => setTipos(true)}>Tipos</Button>}
          {gestao && <Button variant="ghost" icon={<Settings2 size={15} />} onClick={() => setMotivos(true)}>Motivos de espera</Button>}
          {gestao && <Button variant="ghost" icon={<BellRing size={15} />} onClick={() => setAvisos(true)}>Avisos</Button>}
          {podeAbrir && <Button icon={<Plus size={15} />} onClick={() => setNovo(true)}>Novo ticket</Button>}
        </div>}
      />

      {/* filas prontas, com contagem: é por aqui que se faz a gestão do dia */}
      <div className="flex items-center gap-1 rounded-lg bg-field p-1 mb-3 text-xs overflow-x-auto max-w-full">
        {visoes.map((v) => {
          const n = r && v.n ? v.n(r) : undefined;
          return (
            <button key={v.id} type="button" onClick={() => escolher(v)} className={cn('h-7 px-3 rounded-md font-medium whitespace-nowrap inline-flex items-center gap-1', visao === v.id ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink')}>
              {v.label}
              {!!n && <span className={cn('tnum rounded-full px-1.5', v.tom === 'danger' ? 'bg-danger-soft text-danger-ink' : v.tom === 'warn' ? 'bg-warn-soft text-warn-ink' : 'text-accent-ink')}>{n}</span>}
            </button>
          );
        })}
      </div>

      {r && r.holdExpired > 0 && (
        <button type="button" onClick={() => { setVisao('all'); set({ scope: 'all', due: '', status: 'on_hold' }); }} className="mb-3 rounded-lg bg-warn-soft text-warn-ink px-3 py-1.5 text-xs"><PauseCircle size={12} className="inline mr-1" />{r.holdExpired} em espera passaram da data de retomar</button>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-1 rounded-lg bg-field p-1 h-9 text-xs" role="tablist" aria-label="Visualização">
          <button type="button" role="tab" aria-selected={modo === 'lista'} onClick={() => trocarModo('lista')} className={cn('h-7 px-2.5 rounded-md inline-flex items-center gap-1', modo === 'lista' ? 'bg-panel shadow-sm text-ink' : 'text-muted')}><List size={14} /> Lista</button>
          <button type="button" role="tab" aria-selected={modo === 'quadro'} onClick={() => trocarModo('quadro')} className={cn('h-7 px-2.5 rounded-md inline-flex items-center gap-1', modo === 'quadro' ? 'bg-panel shadow-sm text-ink' : 'text-muted')}><Columns3 size={14} /> Quadro</button>
        </div>
        {modo === 'lista' && (
          <select className={selCls} value={q.status ?? ''} onChange={(e) => set({ status: e.target.value as TicketQuery['status'] })} aria-label="Situação">
            <option value="active">Em aberto (todos)</option>
            {(['open', 'in_progress', 'on_hold', 'resolved', 'canceled'] as TicketStatus[]).map((st) => <option key={st} value={st}>{TICKET_STATUS_LABEL[st]}</option>)}
            <option value="">Qualquer situação</option>
          </select>
        )}
        <select className={selCls} value={q.sort ?? 'updated'} onChange={(e) => set({ sort: e.target.value as TicketQuery['sort'] })} aria-label="Ordenar">
          {ORDENS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className={selCls} value={q.priority ?? ''} onChange={(e) => set({ priority: e.target.value as TicketPriority | '' })} aria-label="Prioridade">
          <option value="">Toda prioridade</option>
          {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p]}</option>)}
        </select>
        {visao !== 'to_pick' && (
          <select className={selCls} value={q.responsibleId ?? ''} onChange={(e) => set({ responsibleId: e.target.value })} aria-label="Responsável">
            <option value="">Todo responsável</option>
            <option value="none">Sem responsável</option>
            {opts.data?.users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
        {!!opts.data?.departments.length && (
          <select className={selCls} value={q.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value })} aria-label="Setor">
            <option value="">Todo setor</option>
            {opts.data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="none">Sem setor</option>
          </select>
        )}
        {!!opts.data?.types.length && (
          <select className={selCls} value={q.typeId ?? ''} onChange={(e) => set({ typeId: e.target.value })} aria-label="Tipo">
            <option value="">Todo tipo</option>
            {opts.data.types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isActive ? '' : ' (desativado)'}</option>)}
          </select>
        )}
        <select className={selCls} value={q.source ?? ''} onChange={(e) => set({ source: e.target.value as TicketSource | '' })} aria-label="Origem">
          <option value="">Toda origem</option>
          {(Object.keys(TICKET_SOURCE_LABEL) as TicketSource[]).map((k) => <option key={k} value={k}>{TICKET_SOURCE_LABEL[k]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 rounded-lg bg-field px-2.5 h-9 flex-1 min-w-[12rem]">
          <Search size={14} className="text-faint shrink-0" />
          <input value={q.search ?? ''} onChange={(e) => set({ search: e.target.value })} placeholder="Título, descrição ou #número" className="bg-transparent text-[13px] w-full focus:outline-none" />
          {q.search && <button type="button" onClick={() => set({ search: '' })} className="text-faint hover:text-ink" aria-label="Limpar"><X size={14} /></button>}
        </label>
      </div>

      {modo === 'quadro' && opts.data && <Quadro q={q} opts={opts.data} onAbrir={setAberto} />}

      {modo === 'lista' && (<>
        {sel.length > 0 && opts.data && <AcoesEmMassa ids={sel} opts={opts.data} onFeito={() => setSel([])} />}
        {lista.isLoading && <SkeletonRows rows={5} />}
        {lista.data && !itens.length && <Empty icon={<Ticket size={28} />} title="Nenhum ticket aqui" text={visao === 'mine' ? 'Quando alguém incluir você num ticket, ele aparece aqui.' : 'Mude os filtros ou abra um ticket novo.'} />}
        {itens.length > 0 && (
          <div className="rounded-2xl border border-line bg-panel">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-line text-xs text-muted">
              <input type="checkbox" aria-label="Selecionar todos desta página" checked={todosMarcados} ref={(el) => { if (el) el.indeterminate = sel.length > 0 && !todosMarcados; }} onChange={() => setSel(todosMarcados ? [] : itens.map((t) => t.id))} />
              <span>{sel.length ? `${sel.length} selecionado(s)` : `Selecionar os ${itens.length} desta página`}</span>
            </div>
            <ul className="divide-y divide-line">
              {itens.map((t) => <Linha key={t.id} t={t} marcado={sel.includes(t.id)} onMarcar={() => setSel((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))} onAbrir={() => setAberto(t.id)} />)}
            </ul>
          </div>
        )}
        {lista.data && lista.data.total > lista.data.pageSize && (
          <div className="flex items-center justify-end gap-2 mt-3 text-xs text-muted">
            <span className="tnum">{(lista.data.page - 1) * lista.data.pageSize + 1}–{Math.min(lista.data.total, lista.data.page * lista.data.pageSize)} de {lista.data.total}</span>
            <Button size="sm" variant="ghost" disabled={lista.data.page <= 1} onClick={() => setQ((x) => ({ ...x, page: (x.page ?? 1) - 1 }))}>Anterior</Button>
            <Button size="sm" variant="ghost" disabled={lista.data.page * lista.data.pageSize >= lista.data.total} onClick={() => setQ((x) => ({ ...x, page: (x.page ?? 1) + 1 }))}>Próxima</Button>
          </div>
        )}
      </>)}

      {novo && opts.data && <NewTicketModal opts={opts.data} onClose={() => setNovo(false)} onCriado={(id) => { setNovo(false); setAberto(id); }} />}
      {aberto && opts.data && <Detalhe id={aberto} opts={opts.data} onClose={() => setAberto(null)} />}
      {motivos && opts.data && <MotivosModal opts={opts.data} onClose={() => setMotivos(false)} />}
      {tipos && opts.data && <TiposModal opts={opts.data} onClose={() => setTipos(false)} />}
      {avisos && opts.data && <AvisosModal opts={opts.data} onClose={() => setAvisos(false)} />}
    </PageShell>
  );
}

/** "Pegar para mim": vira responsável (o ticket passa a "em andamento"). */
function usePegar() {
  const w = useTicketWrite();
  const me = useMe().data;
  return { pegar: (t: TicketRow) => w.mutateAsync({ path: `/${t.id}/transfer`, body: { responsibleId: me?.id, keepMe: true } }).then(() => toast.ok(`#${t.number} é seu agora`), toast.err), pending: w.isPending };
}
const podePegar = (t: TicketRow) => !t.responsible && t.canAct && (t.status === 'open' || t.status === 'in_progress');

function Linha({ t, marcado, onMarcar, onAbrir }: { t: TicketRow; marcado: boolean; onMarcar: () => void; onAbrir: () => void }) {
  const outros = t.participants.filter((p) => p.role !== 'responsible');
  const { pegar, pending } = usePegar();
  return (
    <li className={cn('flex items-start gap-3 px-4 py-3 hover:bg-field/60', marcado && 'bg-accent-soft/40')}>
      <input type="checkbox" className="mt-1" aria-label={`Selecionar #${t.number}`} checked={marcado} onChange={onMarcar} />
      <button type="button" onClick={onAbrir} className="min-w-0 flex-1 text-left flex items-start gap-3">
        <span className="text-xs text-faint tnum pt-0.5 w-10 shrink-0">#{t.number}</span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-center gap-2 flex-wrap">
            {t.unread && <span className="w-2 h-2 rounded-full bg-accent shrink-0" aria-label="Novidade não lida" title="Novo ou com novidade desde a última vez que você abriu" />}
            <span className={cn('truncate text-ink', t.unread ? 'font-bold' : 'font-medium')}>{t.title}</span>
            <TipoChip type={t.type} />
            <Chip status={t.status} />
            <Origem source={t.source} />
            {t.priority !== 'normal' && <span className={cn('text-[11px]', PRIO_CLS[t.priority])}>{TICKET_PRIORITY_LABEL[t.priority]}</span>}
            <Prazo t={t} />
          </span>
          <span className="block text-xs text-muted truncate">
            {t.department && <span style={{ color: t.department.color }}>● </span>}{t.department?.name ?? 'Sem setor'}
            {' · '}{t.responsible ? t.responsible.name : 'sem responsável'}{outros.length > 0 && ` +${outros.length}`}
            {t.hold && ` · ${t.hold.reason?.name ?? 'em espera'}${t.hold.until ? ` (retomar ${dia(t.hold.until)})` : ''}`}
            {t.dueAt && !t.hold && ` · prazo ${dia(t.dueAt)}`}
          </span>
        </span>
      </button>
      <span className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[11px] text-faint whitespace-nowrap">{quando(t.updatedAt)}{t.comments > 0 && <> · <MessageSquare size={11} className="inline" /> {t.comments}</>}</span>
        {podePegar(t) && <Button size="sm" variant="subtle" icon={<Hand size={12} />} loading={pending} onClick={() => void pegar(t)}>Pegar</Button>}
      </span>
    </li>
  );
}

/**
 * Barra da seleção: cada ação passa ticket a ticket pela regra do individual (a API devolve os que
 * não deram, com o motivo — ex.: "você não atua neste ticket").
 */
function AcoesEmMassa({ ids, opts, onFeito }: { ids: string[]; opts: TicketOptions; onFeito: () => void }) {
  const bulk = useTicketBulk();
  const me = useMe().data;
  async function executar(b: Omit<TicketBulkInput, 'ids'>, feito: string) {
    try {
      const r = await bulk.mutateAsync({ ids, ...b });
      if (r.ok) toast.ok(`${r.ok} ticket(s) ${feito}`);
      if (r.failed.length) toast.warn(`${r.failed.length} não deram: ${r.failed.slice(0, 3).map((f) => `${f.number ? `#${f.number}` : 'ticket'} — ${f.error}`).join('; ')}${r.failed.length > 3 ? '…' : ''}`);
      onFeito();
    } catch (err) { toast.err(err); }
  }
  const sel = cn(selCls, 'h-8 text-xs');
  return (
    <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2 text-xs shadow-sm">
      <span className="font-medium text-ink">{ids.length} selecionado(s)</span>
      <select className={sel} value="" disabled={bulk.isPending} aria-label="Atribuir a" onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        const responsibleId = v === 'me' ? me?.id ?? null : v === 'none' ? null : v;
        void executar({ action: 'assign', responsibleId }, v === 'none' ? 'sem responsável' : 'atribuídos');
      }}>
        <option value="">Atribuir a…</option>
        <option value="me">Para mim</option>
        <option value="none">Ninguém (o setor pega)</option>
        {opts.users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <select className={sel} value="" disabled={bulk.isPending} aria-label="Mudar situação" onChange={(e) => {
        const st = e.target.value as Exclude<TicketStatus, 'on_hold'> | '';
        if (!st) return;
        if ((st === 'resolved' || st === 'canceled') && !confirm(`${st === 'resolved' ? 'Resolver' : 'Cancelar'} ${ids.length} ticket(s)?\n\nOs que têm reclamante com aviso ligado recebem a mensagem padrão de encerramento no WhatsApp (sem conclusão). Para escrever a conclusão, encerre um a um.`)) return;
        void executar({ action: 'status', status: st }, TICKET_STATUS_LABEL[st].toLowerCase());
      }}>
        <option value="">Situação…</option>
        {(['open', 'in_progress', 'resolved', 'canceled'] as const).map((st) => <option key={st} value={st}>{TICKET_STATUS_LABEL[st]}</option>)}
      </select>
      <select className={sel} value="" disabled={bulk.isPending} aria-label="Mudar prioridade" onChange={(e) => {
        const p = e.target.value as TicketPriority | '';
        if (p) void executar({ action: 'priority', priority: p }, `com prioridade ${TICKET_PRIORITY_LABEL[p].toLowerCase()}`);
      }}>
        <option value="">Prioridade…</option>
        {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p]}</option>)}
      </select>
      <select className={sel} value="" disabled={bulk.isPending} aria-label="Congelar" onChange={(e) => {
        const reasonId = e.target.value;
        if (reasonId) void executar({ action: 'hold', reasonId }, 'em espera');
      }}>
        <option value="">Congelar…</option>
        {opts.holdReasons.filter((h) => h.isActive).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
      {bulk.isPending && <span className="text-muted">Aplicando…</span>}
      <button type="button" onClick={onFeito} className="ml-auto p-1 text-faint hover:text-ink" title="Limpar seleção"><X size={14} /></button>
    </div>
  );
}

/**
 * Quadro por situação: uma coluna por situação (cancelado fica só na lista). Arrastar muda a
 * situação; para "Em espera" pede o motivo; sair da espera é "retomar".
 */
function Quadro({ q, opts, onAbrir }: { q: TicketQuery; opts: TicketOptions; onAbrir: (id: string) => void }) {
  const w = useTicketWrite();
  const [congelar, setCongelar] = useState<TicketRow | null>(null);
  const [resolver, setResolver] = useState<TicketRow | null>(null);
  // uma consulta por coluna, com os mesmos filtros (a situação é a coluna); resolvidos: os últimos
  const filtros = { ...q, status: undefined, page: 1, pageSize: 50 };
  const cols = {
    open: useTickets({ ...filtros, status: 'open', sort: q.sort ?? 'due' }),
    in_progress: useTickets({ ...filtros, status: 'in_progress', sort: q.sort ?? 'due' }),
    on_hold: useTickets({ ...filtros, status: 'on_hold', sort: q.sort ?? 'due' }),
    resolved: useTickets({ ...filtros, status: 'resolved', sort: 'updated' }),
  } as Record<string, ReturnType<typeof useTickets>>;

  function onDragEnd(r: DropResult) {
    const de = r.source.droppableId as TicketStatus;
    const para = r.destination?.droppableId as TicketStatus | undefined;
    if (!para || para === de) return;
    const t = cols[de].data?.items.find((x) => x.id === r.draggableId);
    if (!t) return;
    if (!t.canAct) return toast.err('Você pode ver este ticket, mas não atua nele.');
    if (para === 'on_hold') return setCongelar(t);
    // resolver pede a conclusão (e revisa o aviso ao reclamante)
    if (para === 'resolved') return setResolver(t);
    const req = de === 'on_hold' && (para === 'open' || para === 'in_progress')
      ? w.mutateAsync({ path: `/${t.id}/resume`, body: {} })
      : w.mutateAsync({ path: `/${t.id}/status`, body: { status: para } });
    req.then(() => toast.ok(`#${t.number}: ${TICKET_STATUS_LABEL[para]}`), toast.err);
  }

  return (
    <>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUNAS.map((st) => {
            const d = cols[st].data;
            return (
              <Droppable key={st} droppableId={st}>
                {(drop, snap) => (
                  <section ref={drop.innerRef} {...drop.droppableProps} className={cn('rounded-2xl border border-line bg-field/50 p-2 min-h-40 flex flex-col', snap.isDraggingOver && 'ring-2 ring-accent/40')}>
                    <header className="flex items-center justify-between px-1.5 pb-2">
                      <Chip status={st} />
                      <span className="text-xs text-faint tnum">{d ? (d.total > d.items.length ? `${d.items.length} de ${d.total}` : d.total) : '…'}</span>
                    </header>
                    <div className="space-y-2 flex-1">
                      {d?.items.map((t, i) => (
                        <Draggable key={t.id} draggableId={t.id} index={i} isDragDisabled={!t.canAct}>
                          {(drag, ds) => (
                            <div ref={drag.innerRef} {...drag.draggableProps} {...drag.dragHandleProps} className={cn('rounded-xl border border-line bg-panel p-2.5 text-left space-y-1', ds.isDragging && 'shadow-lg')}>
                              <button type="button" onClick={() => onAbrir(t.id)} className="w-full text-left space-y-1">
                                <span className="flex items-center gap-1.5 text-[11px] text-faint">
                                  <span className="tnum">#{t.number}</span>
                                  {t.unread && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                                  {t.priority !== 'normal' && <span className={PRIO_CLS[t.priority]}>{TICKET_PRIORITY_LABEL[t.priority]}</span>}
                                  <Prazo t={t} />
                                </span>
                                <span className={cn('block text-sm text-ink leading-snug line-clamp-2', t.unread ? 'font-bold' : 'font-medium')}>{t.title}</span>
                                <span className="block text-[11px] text-muted truncate">
                                  {t.department?.name ?? 'Sem setor'} · {t.responsible?.name ?? 'sem responsável'}
                                  {t.hold && ` · ${t.hold.reason?.name ?? 'em espera'}`}
                                </span>
                              </button>
                              {podePegar(t) && <PegarBotao t={t} />}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {drop.placeholder}
                      {d && !d.items.length && <p className="text-xs text-faint text-center py-6">Nada aqui</p>}
                    </div>
                  </section>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>
      {congelar && (
        <Modal open onClose={() => setCongelar(null)} title={`Congelar #${congelar.number}`} width="max-w-md">
          <CongelarForm opts={opts} loading={w.isPending} onCancel={() => setCongelar(null)} onSalvar={(b) => w.mutateAsync({ path: `/${congelar.id}/hold`, body: b }).then(() => { toast.ok('Ticket em espera'); setCongelar(null); }, toast.err)} />
        </Modal>
      )}
      {resolver && <EncerrarModal t={resolver} status="resolved" opts={opts} onClose={() => setResolver(null)} />}
    </>
  );
}

/**
 * Reclamante (docs/tickets.md#reclamante): o contato que pediu. Recebe aviso no WhatsApp na
 * abertura e no encerramento enquanto o aviso estiver ligado.
 */
function BlocoReclamante({ t, podeEditar, fazer }: { t: TicketDetail; podeEditar: boolean; fazer: (path: string, body?: unknown, ok?: string, method?: 'POST' | 'PATCH' | 'DELETE') => Promise<unknown> }) {
  const [trocando, setTrocando] = useState(false);
  if (!t.requester && !podeEditar) return null;
  return (
    <div className="rounded-lg border border-line px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted uppercase tracking-wide">Reclamante</span>
        {podeEditar && <Button size="sm" variant="ghost" icon={<UserRound size={13} />} onClick={() => setTrocando(!trocando)}>{t.requester ? 'Trocar' : 'Vincular'}</Button>}
      </div>
      {t.requester ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-ink">{nomeDoReclamante(t.requester)}{t.requester.name && <span className="text-faint text-xs"> · {t.requester.phone}</span>}</span>
          <label className={cn('flex items-center gap-1.5 text-xs', podeEditar ? 'cursor-pointer text-muted' : 'text-faint')}>
            <input type="checkbox" disabled={!podeEditar} checked={t.notifyRequester} onChange={(e) => void fazer('', { notifyRequester: e.target.checked }, e.target.checked ? 'Aviso ligado' : 'Aviso desligado', 'PATCH')} />
            <BellRing size={12} /> avisar no WhatsApp ao encerrar
          </label>
          {podeEditar && <button type="button" className="text-xs text-faint hover:text-danger-ink" onClick={() => confirm('Tirar o reclamante deste ticket?') && void fazer('', { requesterContactId: null }, 'Reclamante removido', 'PATCH')}>tirar</button>}
        </div>
      ) : <p className="text-sm text-faint">Ninguém. Vincule o contato que pediu para ele ser avisado quando o ticket for encerrado.</p>}
      {trocando && <ReclamantePicker value={null} autoFocus onChange={(r) => { if (r) void fazer('', { requesterContactId: r.id }, 'Reclamante vinculado', 'PATCH').then(() => setTrocando(false)); }} />}
    </div>
  );
}

function PegarBotao({ t }: { t: TicketRow }) {
  const { pegar, pending } = usePegar();
  return <Button size="sm" variant="subtle" icon={<Hand size={12} />} loading={pending} onClick={() => void pegar(t)}>Pegar</Button>;
}

/** Editar no detalhe: título, descrição, prioridade, prazo e os campos do tipo. */
function EditarForm({ t, onCancel, onSalvar, loading }: { t: TicketDetail; onCancel: () => void; onSalvar: (b: Record<string, unknown>) => void; loading: boolean }) {
  const [f, setF] = useState({ title: t.title, description: t.description ?? '', priority: t.priority, dueAt: t.dueAt ? ymdSP(t.dueAt) : '', fields: t.fields });
  return (
    <form className="rounded-lg border border-line p-3 space-y-3" onSubmit={(e) => {
      e.preventDefault();
      onSalvar({
        title: f.title, description: f.description.trim() || null, priority: f.priority, dueAt: f.dueAt ? fimDoDia(f.dueAt) : null,
        ...(t.typeFields.length > 0 && { fields: f.fields }),
      });
    }}>
      <Field label="Título"><input className={inputCls} value={f.title} minLength={3} maxLength={TICKET_TITLE_MAX} required onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Descrição"><textarea className={cn(inputCls, 'min-h-[4rem]')} value={f.description} maxLength={TICKET_TEXT_MAX} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Prioridade">
          <select className={inputCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TicketPriority })}>
            {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p]}</option>)}
          </select>
        </Field>
        <Field label="Prazo"><DateInput value={f.dueAt} clearable onChange={(dueAt) => setF({ ...f, dueAt })} aria-label="Prazo" /></Field>
      </div>
      {t.typeFields.length > 0 && <CamposDoTipo fields={t.typeFields} values={f.fields} onChange={(fields) => setF({ ...f, fields })} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={loading} loadingText="Salvando…">Salvar</Button>
      </div>
    </form>
  );
}

type Acao = null | 'espera' | 'transferir' | 'pessoa' | 'editar';

function Detalhe({ id, opts, onClose }: { id: string; opts: TicketOptions; onClose: () => void }) {
  const q = useTicket(id);
  const w = useTicketWrite();
  const me = useMe().data;
  const gestao = useCan('tickets.manage');
  const openAtMessage = useUI((s) => s.openAtMessage);
  const router = useRouter();
  const [acao, setAcao] = useState<Acao>(null);
  const [encerrar, setEncerrar] = useState<'resolved' | 'canceled' | null>(null);
  const [comentario, setComentario] = useState('');
  const t = q.data;
  const fazer = (path: string, body?: unknown, ok?: string, method: 'POST' | 'PATCH' | 'DELETE' = 'POST') =>
    w.mutateAsync({ path: `/${id}${path}`, method, body }).then((r) => { if (ok) toast.ok(ok); if (r && 'left' in r) onClose(); }, toast.err);
  if (!t) return <Modal open onClose={onClose} title="Ticket" width="max-w-3xl"><SkeletonRows rows={6} /></Modal>;

  const encerrado = t.status === 'resolved' || t.status === 'canceled';
  const souParticipante = t.participants.some((p) => p.id === me?.id);
  const souResponsavel = t.responsible?.id === me?.id;
  const dono = t.createdBy?.id === me?.id;
  const nome = (uid: unknown) => opts.users.find((u) => u.id === uid)?.name ?? t.participants.find((p) => p.id === uid)?.name ?? 'alguém';

  async function comentar(e: React.FormEvent) {
    e.preventDefault();
    if (!comentario.trim()) return;
    await fazer('/comments', { body: comentario });
    setComentario('');
  }

  return (
    <Modal open onClose={onClose} title={`#${t.number} · ${t.title}`} width="max-w-3xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <TipoChip type={t.type} />
          <Chip status={t.status} />
          <Origem source={t.source} />
          <span className={PRIO_CLS[t.priority]}>Prioridade {TICKET_PRIORITY_LABEL[t.priority].toLowerCase()}</span>
          <span className="text-muted">· {t.department?.name ?? 'Sem setor'}</span>
          {t.dueAt && <span className="text-muted">· prazo {dia(t.dueAt)}</span>}
          <span className="text-faint">· aberto {t.createdBy ? `por ${t.createdBy.name}` : `pelo ${TICKET_SOURCE_LABEL[t.source].toLowerCase()}`} em {quando(t.createdAt)}</span>
          {t.conversation && (t.conversation.canOpen ? (
            <Link href="/conversas" onClick={() => openAtMessage(t.conversation!.id, t.messageId)} className="text-accent-ink hover:underline inline-flex items-center gap-1" title={t.messageId ? 'Abrir a conversa no momento em que o ticket foi aberto' : 'Abrir a conversa'}>
              <MessageSquare size={12} /> {t.conversation.contact.name ?? t.conversation.contact.phone}
            </Link>
          ) : (
            <span className="text-muted inline-flex items-center gap-1" title="A conversa é de um número ou setor que você não atende; o trecho dela está abaixo">
              <MessageSquare size={12} /> {t.conversation.contact.name ?? t.conversation.contact.phone}
            </span>
          ))}
        </div>

        {t.hold && (
          <div className="rounded-lg bg-warn-soft text-warn-ink px-3 py-2 text-sm">
            <b>Em espera:</b> {t.hold.reason?.name ?? '—'}{t.hold.since && <span className="text-xs"> desde {quando(t.hold.since)}</span>}
            {t.hold.until && <span className={cn('text-xs', new Date(t.hold.until) < new Date() && 'font-semibold')}> · retomar em {dia(t.hold.until)}{new Date(t.hold.until) < new Date() && ' (passou)'}</span>}
            {t.hold.note && <p className="text-xs mt-0.5">{t.hold.note}</p>}
          </div>
        )}

        <ValoresDoTicket fields={t.typeFields} values={t.fields} />
        {t.description && <p className="text-sm text-ink whitespace-pre-wrap rounded-lg bg-field px-3 py-2">{t.description}</p>}

        {!!t.context?.length && <ContextoDaConversa t={t} onVer={t.conversation?.canOpen ? () => { openAtMessage(t.conversation!.id, t.messageId); router.push('/conversas'); } : undefined} />}

        <BlocoReclamante t={t} podeEditar={t.canAct && !encerrado} fazer={fazer} />

        <div className="rounded-lg border border-line px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted uppercase tracking-wide">Quem atua</span>
            {t.canAct && !encerrado && <Button size="sm" variant="ghost" icon={<UserPlus size={13} />} onClick={() => setAcao(acao === 'pessoa' ? null : 'pessoa')}>Incluir</Button>}
          </div>
          {!t.participants.length && <p className="text-sm text-faint">Ninguém ainda — fica com quem atende o setor.</p>}
          <ul className="flex flex-wrap gap-1.5">
            {t.participants.map((p) => (
              <li key={p.id} className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs', p.role === 'responsible' ? 'bg-accent-soft text-accent-ink font-medium' : 'bg-field text-ink')}>
                {p.name}{p.role === 'responsible' && ' · responsável'}
                {!encerrado && (t.canAct || p.id === me?.id) && (
                  <button type="button" title={p.id === me?.id ? 'Sair do ticket' : 'Tirar do ticket'} onClick={() => confirm(p.id === me?.id ? 'Sair deste ticket?' : `Tirar ${p.name} do ticket?`) && fazer(`/participants/${p.id}`, undefined, undefined, 'DELETE')}><UserMinus size={11} /></button>
                )}
              </li>
            ))}
          </ul>
          {acao === 'pessoa' && <IncluirPessoa opts={opts} t={t} onFeito={() => setAcao(null)} fazer={fazer} />}
        </div>

        {!encerrado && t.canAct && (
          <div className="flex flex-wrap gap-2">
            {!souResponsavel && <Button size="sm" variant="ghost" icon={<Hand size={13} />} onClick={() => fazer('/participants', { userId: me?.id, role: 'responsible' }, 'Ticket assumido')}>Assumir</Button>}
            {t.status === 'open' && souParticipante && <Button size="sm" variant="ghost" icon={<PlayCircle size={13} />} onClick={() => fazer('/status', { status: 'in_progress' })}>Começar</Button>}
            {t.status !== 'on_hold'
              ? <Button size="sm" variant="ghost" icon={<PauseCircle size={13} />} onClick={() => setAcao(acao === 'espera' ? null : 'espera')}>Congelar</Button>
              : <Button size="sm" variant="ghost" icon={<PlayCircle size={13} />} onClick={() => fazer('/resume', {}, 'Ticket retomado')}>Retomar</Button>}
            <Button size="sm" variant="ghost" icon={<ArrowRightLeft size={13} />} onClick={() => setAcao(acao === 'transferir' ? null : 'transferir')}>Transferir</Button>
            <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setAcao(acao === 'editar' ? null : 'editar')}>Editar</Button>
            <Button size="sm" variant="success" icon={<CheckCircle2 size={13} />} onClick={() => setEncerrar('resolved')}>Resolver</Button>
          </div>
        )}
        {!encerrado && (gestao || dono) && t.status !== 'resolved' && (
          <button type="button" className="text-xs text-danger-ink hover:underline inline-flex items-center gap-1" onClick={() => setEncerrar('canceled')}><Ban size={12} /> Cancelar ticket</button>
        )}
        {encerrado && (t.canAct || dono) && <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => fazer('/status', { status: t.responsible ? 'in_progress' : 'open' }, 'Ticket reaberto')}>Reabrir</Button>}

        {acao === 'espera' && <CongelarForm opts={opts} onCancel={() => setAcao(null)} onSalvar={(b) => fazer('/hold', b, 'Ticket em espera').then(() => setAcao(null))} loading={w.isPending} />}
        {encerrar && <EncerrarModal t={t} status={encerrar} opts={opts} onClose={() => setEncerrar(null)} />}
        {acao === 'editar' && <EditarForm t={t} loading={w.isPending} onCancel={() => setAcao(null)} onSalvar={(b) => fazer('', b, 'Ticket atualizado', 'PATCH').then(() => setAcao(null))} />}
        {acao === 'transferir' && <TransferirForm opts={opts} t={t} onCancel={() => setAcao(null)} onSalvar={(b) => fazer('/transfer', b, 'Ticket transferido').then(() => setAcao(null))} loading={w.isPending} />}

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">Linha do tempo</h3>
          <ol className="space-y-2">
            {t.events.map((e) => <Evento key={e.id} e={e} nome={nome} opts={opts} />)}
          </ol>
          {(t.canAct || dono) && (
            <form onSubmit={comentar} className="flex gap-2 items-end">
              <textarea className={cn(inputCls, 'min-h-[2.75rem] flex-1')} value={comentario} maxLength={TICKET_TEXT_MAX} onChange={(e) => setComentario(e.target.value)} placeholder="Comentar (todos que atuam recebem o aviso)" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void comentar(e); }} />
              <Button type="submit" icon={<Send size={14} />} loading={w.isPending} disabled={!comentario.trim()}>Enviar</Button>
            </form>
          )}
        </div>
      </div>
    </Modal>
  );
}

function IncluirPessoa({ opts, t, onFeito, fazer }: { opts: TicketOptions; t: TicketDetail; onFeito: () => void; fazer: (path: string, body?: unknown, ok?: string) => Promise<unknown> }) {
  const [uid, setUid] = useState('');
  const [resp, setResp] = useState(false);
  const livres = opts.users.filter((u) => !t.participants.some((p) => p.id === u.id));
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <select className={selCls} value={uid} onChange={(e) => setUid(e.target.value)} aria-label="Pessoa">
        <option value="">Escolha a pessoa…</option>
        {livres.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={resp} onChange={(e) => setResp(e.target.checked)} /> como responsável</label>
      <Button size="sm" disabled={!uid} onClick={() => fazer('/participants', { userId: uid, role: resp ? 'responsible' : 'participant' }, 'Pessoa incluída').then(onFeito)}>Incluir</Button>
    </div>
  );
}

function CongelarForm({ opts, onCancel, onSalvar, loading }: { opts: TicketOptions; onCancel: () => void; onSalvar: (b: { reasonId: string; note?: string; until?: string }) => void; loading: boolean }) {
  const ativos = opts.holdReasons.filter((r) => r.isActive);
  const [f, setF] = useState({ reasonId: ativos[0]?.id ?? '', note: '', until: '' });
  return (
    <div className="rounded-lg border border-line bg-warn-soft p-3 space-y-2">
      <p className="text-sm font-medium text-ink">Congelar: o ticket espera algo de fora</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Esperando">
          <select className={inputCls} value={f.reasonId} onChange={(e) => setF({ ...f, reasonId: e.target.value })}>
            {ativos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Retomar em"><DateInput value={f.until} min={hojeYmd()} clearable onChange={(until) => setF({ ...f, until })} aria-label="Retomar em" /></Field>
      </div>
      <Field label="Observação"><input className={inputCls} value={f.note} maxLength={TICKET_TEXT_MAX} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ex.: eletricista vem quinta de manhã" /></Field>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" disabled={!f.reasonId} loading={loading} onClick={() => onSalvar({ reasonId: f.reasonId, note: f.note || undefined, until: f.until ? fimDoDia(f.until) : undefined })}>Congelar</Button>
      </div>
    </div>
  );
}

function TransferirForm({ opts, t, onCancel, onSalvar, loading }: { opts: TicketOptions; t: TicketDetail; onCancel: () => void; onSalvar: (b: { departmentId: string | null; responsibleId: string | null; keepMe: boolean; note?: string }) => void; loading: boolean }) {
  const [f, setF] = useState({ departmentId: t.department?.id ?? '', responsibleId: '', keepMe: true, note: '' });
  const doSetor = opts.users.filter((u) => !f.departmentId || u.departmentIds.includes(f.departmentId));
  const outros = opts.users.filter((u) => !doSetor.includes(u));
  return (
    <div className="rounded-lg border border-line p-3 space-y-2">
      <p className="text-sm font-medium text-ink">Transferir</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Para o setor">
          <select className={inputCls} value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value, responsibleId: '' })}>
            <option value="">Sem setor</option>
            {opts.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Novo responsável">
          <select className={inputCls} value={f.responsibleId} onChange={(e) => setF({ ...f, responsibleId: e.target.value })}>
            <option value="">Ninguém (o setor assume)</option>
            {doSetor.length > 0 && <optgroup label={f.departmentId ? 'Do setor' : 'Equipe'}>{doSetor.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>}
            {f.departmentId && outros.length > 0 && <optgroup label="Outros">{outros.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>}
          </select>
        </Field>
      </div>
      <Field label="Recado"><input className={inputCls} value={f.note} maxLength={TICKET_TEXT_MAX} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Por que está passando adiante" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.keepMe} onChange={(e) => setF({ ...f, keepMe: e.target.checked })} /> Continuar acompanhando (fico como participante)</label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" loading={loading} onClick={() => onSalvar({ departmentId: f.departmentId || null, responsibleId: f.responsibleId || null, keepMe: f.keepMe, note: f.note || undefined })}>Transferir</Button>
      </div>
    </div>
  );
}

function Evento({ e, nome, opts }: { e: TicketEvent; nome: (uid: unknown) => string; opts: TicketOptions }) {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const d0 = (e.data ?? {}) as Record<string, unknown>;
  // aberto pela automação: "Fluxo “Portaria”" no lugar da pessoa
  const quem = e.actor?.name ?? (d0.source === 'flow' ? `Fluxo “${d0.origin}”` : d0.source === 'agent' ? `Agente “${d0.origin}”` : 'Sistema');
  const setor = (sid: unknown) => (sid ? opts.departments.find((x) => x.id === sid)?.name ?? 'outro setor' : 'sem setor');
  const texto = (() => {
    switch (e.type) {
      case 'created': return 'abriu o ticket';
      case 'comment': return null;
      case 'status': return `mudou para ${TICKET_STATUS_LABEL[d.to as TicketStatus] ?? d.to}`;
      case 'hold': return `congelou: ${d.reason}${d.until ? ` (retomar ${dia(String(d.until))})` : ''}`;
      case 'resume': return `retomou${d.reason ? ` (estava: ${d.reason})` : ''}`;
      case 'transfer': return `transferiu${d.fromDepartmentId !== d.toDepartmentId ? ` de ${setor(d.fromDepartmentId)} para ${setor(d.toDepartmentId)}` : ''}${d.toResponsibleId !== d.fromResponsibleId ? ` · responsável: ${d.toResponsibleId ? nome(d.toResponsibleId) : 'ninguém'}` : ''}`;
      case 'participant_added': return `incluiu ${nome(d.userId)}${d.role === 'responsible' ? ' como responsável' : ''}`;
      case 'participant_removed': return `tirou ${nome(d.userId)}`;
      case 'edited': return `editou ${(d.fields as string[] | undefined)?.map((f) => ({ title: 'o título', description: 'a descrição', priority: 'a prioridade', dueAt: 'o prazo', fields: 'os campos', requester: 'o reclamante', notifyRequester: 'o aviso ao reclamante' } as Record<string, string>)[f] ?? f).join(', ')}`;
      case 'notice': return d.ok
        ? `avisou o reclamante no WhatsApp (${d.kind === 'opened' ? 'abertura' : 'encerramento'})`
        : `tentou avisar o reclamante (${d.kind === 'opened' ? 'abertura' : 'encerramento'}), mas não saiu: ${d.error ?? 'erro no envio'}`;
      default: return e.type;
    }
  })();
  if (e.type === 'comment') {
    return (
      <li className="rounded-lg bg-field px-3 py-2">
        <p className="text-[11px] text-muted"><b className="text-ink">{quem}</b> · {quando(e.createdAt)}</p>
        <p className="text-sm text-ink whitespace-pre-wrap">{e.body}</p>
      </li>
    );
  }
  return (
    <li className="text-xs text-muted px-1">
      <span className="text-faint">{quando(e.createdAt)}</span> · <b className="text-ink font-medium">{quem}</b> {texto}
      {e.body && <span className="block pl-3 text-ink">“{e.body}”</span>}
    </li>
  );
}

function MotivosModal({ opts, onClose }: { opts: TicketOptions; onClose: () => void }) {
  const w = useTicketWrite();
  const [novo, setNovo] = useState('');
  const salvar = (path: string, body?: unknown, method: 'POST' | 'PATCH' | 'DELETE' = 'POST') => w.mutateAsync({ path: `/hold-reasons${path}`, method, body }).catch(toast.err);
  return (
    <Modal open onClose={onClose} title="Motivos de espera" width="max-w-md">
      <div className="space-y-3">
        <p className="text-xs text-muted">Por que um ticket fica parado esperando algo de fora. Em uso, excluir só desativa (o histórico guarda o nome).</p>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {opts.holdReasons.map((r) => (
            <li key={r.id} className={cn('flex items-center gap-2 px-3 py-2 text-sm', !r.isActive && 'opacity-50')}>
              <span className="flex-1">{r.name}</span>
              <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => salvar(`/${r.id}`, { name: r.name, isActive: !r.isActive }, 'PATCH')}>{r.isActive ? 'Desativar' : 'Ativar'}</button>
              <button type="button" className="text-faint hover:text-danger p-1" aria-label="Excluir" onClick={() => confirm(`Excluir "${r.name}"?`) && salvar(`/${r.id}`, undefined, 'DELETE')}><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (novo.trim()) void salvar('', { name: novo }).then(() => setNovo('')); }}>
          <input className={inputCls} value={novo} maxLength={80} onChange={(e) => setNovo(e.target.value)} placeholder="Ex.: Aguardando síndico" />
          <Button type="submit" icon={<Plus size={14} />} loading={w.isPending}>Incluir</Button>
        </form>
      </div>
    </Modal>
  );
}

/**
 * Retrato da conversa guardado na abertura (docs/tickets.md#aberto-de-uma-conversa): as últimas
 * mensagens até o momento escolhido, com ele destacado. Fica mesmo se a conversa for apagada.
 */
function ContextoDaConversa({ t, onVer }: { t: TicketDetail; onVer?: () => void }) {
  const [tudo, setTudo] = useState(false);
  const msgs = t.context ?? [];
  const lista = tudo ? msgs : msgs.slice(-4);
  const contato = t.conversation?.contact.name ?? 'Contato';
  return (
    <section className="rounded-lg border border-line">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-line text-xs">
        <MessageSquare size={13} className="text-accent" />
        <b className="text-ink flex-1">Contexto da conversa</b>
        {msgs.length > 4 && <button type="button" onClick={() => setTudo((v) => !v)} className="text-muted hover:text-ink">{tudo ? 'Mostrar menos' : `Ver as ${msgs.length}`}</button>}
        {onVer && <button type="button" onClick={onVer} className="text-accent-ink font-semibold hover:underline">Ver na conversa</button>}
      </header>
      <ul className="px-3 py-2 space-y-1.5 max-h-72 overflow-y-auto">
        {lista.map((m) => (
          <li key={m.id} className={cn('flex', m.from === 'in' ? 'justify-start' : m.from === 'note' ? 'justify-center' : 'justify-end')}>
            <div className={cn('max-w-[85%] rounded-xl px-2.5 py-1.5 text-[12.5px]',
              m.from === 'in' ? 'bg-field text-ink' : m.from === 'note' ? 'bg-warn-soft text-ink border border-dashed border-warn/60' : 'bg-accent-soft text-ink',
              m.anchor && 'ring-2 ring-accent')}>
              <div className="text-[10.5px] text-muted flex gap-2">
                <span className="font-semibold">{m.from === 'in' ? (m.author ?? contato) : m.from === 'note' ? `Nota · ${m.author ?? 'sistema'}` : (m.author ?? 'Robô')}</span>
                <span className="tnum">{quando(m.at)}</span>
                {m.anchor && <span className="text-accent-ink font-semibold">ticket aberto aqui</span>}
              </div>
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
