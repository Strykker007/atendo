'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Ticket, Plus, Search, X, PauseCircle, PlayCircle, ArrowRightLeft, CheckCircle2, RotateCcw, Ban, UserPlus, UserMinus, Send, MessageSquare, Settings2, Trash2, Hand, Clock } from 'lucide-react';
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL, TICKET_STATUS_LABEL, TICKET_TEXT_MAX, TICKET_TITLE_MAX, type TicketPriority, type TicketStatus } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { DateInput } from '@/components/ui/DatePicker';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { useUI } from '@/lib/store';
import { useCan, useMe, useTicket, useTicketOptions, useTickets, useTicketsSummary, useTicketWrite, type TicketDetail, type TicketEvent, type TicketOptions, type TicketQuery, type TicketRow } from '@/lib/hooks';

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
const hojeYmd = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
/** "AAAA-MM-DD" → fim do dia em Brasília (prazo e retomada valem o dia inteiro) */
const fimDoDia = (ymd: string) => `${ymd}T23:59:00-03:00`;

function Chip({ status }: { status: TicketStatus }) {
  return <span className={cn('text-[11px] rounded-full px-2 py-0.5 whitespace-nowrap', STATUS_CLS[status])}>{TICKET_STATUS_LABEL[status]}</span>;
}

/**
 * Tickets internos (docs/tickets.md): um setor pede algo a outro. Várias pessoas atuam no mesmo
 * ticket, dá para transferir e congelar "Em espera" por motivo externo.
 */
export default function TicketsPage() {
  const podeAbrir = useCan('tickets.create');
  const atende = useCan('tickets.handle');
  const verTodos = useCan('tickets.view_all');
  const gestao = useCan('tickets.manage');
  const resumo = useTicketsSummary();
  const [q, setQ] = useState<TicketQuery>({ scope: 'mine', status: 'active', page: 1 });
  const set = (p: Partial<TicketQuery>) => setQ((x) => ({ ...x, page: 1, ...p }));
  const lista = useTickets(q);
  const opts = useTicketOptions();
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [motivos, setMotivos] = useState(false);
  const r = resumo.data;

  const abas: [NonNullable<TicketQuery['scope']>, string, number | undefined][] = [
    ['mine', 'Comigo', r?.mine],
    ...(atende ? [['department', 'Do meu setor', r?.department] as [NonNullable<TicketQuery['scope']>, string, number | undefined]] : []),
    ['created', 'Que abri', undefined],
    ...(verTodos || gestao ? [['all', 'Todos', undefined] as [NonNullable<TicketQuery['scope']>, string, number | undefined]] : []),
  ];

  return (
    <PageShell width="max-w-6xl">
      <PageHeader
        title="Tickets"
        subtitle="Pedidos entre setores: quem abre, quem atua junto, o que está esperando algo de fora."
        action={<div className="flex gap-2">
          {gestao && <Button variant="ghost" icon={<Settings2 size={15} />} onClick={() => setMotivos(true)}>Motivos de espera</Button>}
          {podeAbrir && <Button icon={<Plus size={15} />} onClick={() => setNovo(true)}>Novo ticket</Button>}
        </div>}
      />

      {r && (r.holdExpired > 0 || r.overdue > 0) && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {r.overdue > 0 && <button type="button" onClick={() => set({ scope: verTodos || gestao ? 'all' : 'mine', status: 'active' })} className="rounded-lg bg-danger-soft text-danger-ink px-3 py-1.5"><Clock size={12} className="inline mr-1" />{r.overdue} com prazo vencido</button>}
          {r.holdExpired > 0 && <button type="button" onClick={() => set({ status: 'on_hold' })} className="rounded-lg bg-warn-soft text-warn-ink px-3 py-1.5"><PauseCircle size={12} className="inline mr-1" />{r.holdExpired} em espera passaram da data de retomar</button>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-1 rounded-lg bg-field p-1 h-9 text-xs overflow-x-auto max-w-full">
          {abas.map(([k, l, n]) => (
            <button key={k} type="button" onClick={() => set({ scope: k })} className={cn('h-7 px-3 rounded-md font-medium whitespace-nowrap', q.scope === k ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink')}>
              {l}{n ? <span className="ml-1 tnum text-accent-ink">{n}</span> : null}
            </button>
          ))}
        </div>
        <select className={selCls} value={q.status ?? ''} onChange={(e) => set({ status: e.target.value as TicketQuery['status'] })} aria-label="Situação">
          <option value="active">Em aberto (todos)</option>
          {(['open', 'in_progress', 'on_hold', 'resolved', 'canceled'] as TicketStatus[]).map((s) => <option key={s} value={s}>{TICKET_STATUS_LABEL[s]}</option>)}
          <option value="">Qualquer situação</option>
        </select>
        <select className={selCls} value={q.priority ?? ''} onChange={(e) => set({ priority: e.target.value as TicketPriority | '' })} aria-label="Prioridade">
          <option value="">Toda prioridade</option>
          {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p]}</option>)}
        </select>
        {!!opts.data?.departments.length && (
          <select className={selCls} value={q.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value })} aria-label="Setor">
            <option value="">Todo setor</option>
            {opts.data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="none">Sem setor</option>
          </select>
        )}
        <label className="flex items-center gap-1.5 rounded-lg bg-field px-2.5 h-9 flex-1 min-w-[12rem]">
          <Search size={14} className="text-faint shrink-0" />
          <input value={q.search ?? ''} onChange={(e) => set({ search: e.target.value })} placeholder="Título, descrição ou #número" className="bg-transparent text-[13px] w-full focus:outline-none" />
          {q.search && <button type="button" onClick={() => set({ search: '' })} className="text-faint hover:text-ink" aria-label="Limpar"><X size={14} /></button>}
        </label>
      </div>

      {lista.isLoading && <SkeletonRows rows={5} />}
      {lista.data && !lista.data.items.length && <Empty icon={<Ticket size={28} />} title="Nenhum ticket aqui" text={q.scope === 'mine' ? 'Quando alguém incluir você num ticket, ele aparece aqui.' : 'Mude os filtros ou abra um ticket novo.'} />}
      {lista.data && lista.data.items.length > 0 && (
        <ul className="rounded-2xl border border-line bg-panel divide-y divide-line">
          {lista.data.items.map((t) => <Linha key={t.id} t={t} onAbrir={() => setAberto(t.id)} />)}
        </ul>
      )}
      {lista.data && lista.data.total > lista.data.pageSize && (
        <div className="flex items-center justify-end gap-2 mt-3 text-xs text-muted">
          <span className="tnum">{(lista.data.page - 1) * lista.data.pageSize + 1}–{Math.min(lista.data.total, lista.data.page * lista.data.pageSize)} de {lista.data.total}</span>
          <Button size="sm" variant="ghost" disabled={lista.data.page <= 1} onClick={() => setQ((x) => ({ ...x, page: (x.page ?? 1) - 1 }))}>Anterior</Button>
          <Button size="sm" variant="ghost" disabled={lista.data.page * lista.data.pageSize >= lista.data.total} onClick={() => setQ((x) => ({ ...x, page: (x.page ?? 1) + 1 }))}>Próxima</Button>
        </div>
      )}

      {novo && opts.data && <NovoTicket opts={opts.data} onClose={() => setNovo(false)} onCriado={(id) => { setNovo(false); setAberto(id); }} />}
      {aberto && opts.data && <Detalhe id={aberto} opts={opts.data} onClose={() => setAberto(null)} />}
      {motivos && opts.data && <MotivosModal opts={opts.data} onClose={() => setMotivos(false)} />}
    </PageShell>
  );
}

function Linha({ t, onAbrir }: { t: TicketRow; onAbrir: () => void }) {
  const atrasado = !!t.dueAt && ['open', 'in_progress'].includes(t.status) && new Date(t.dueAt) < new Date();
  const outros = t.participants.filter((p) => p.role !== 'responsible');
  return (
    <li>
      <button type="button" onClick={onAbrir} className="w-full text-left px-4 py-3 hover:bg-field/60 flex items-start gap-3">
        <span className="text-xs text-faint tnum pt-0.5 w-10 shrink-0">#{t.number}</span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-ink truncate">{t.title}</span>
            <Chip status={t.status} />
            {t.priority !== 'normal' && <span className={cn('text-[11px]', PRIO_CLS[t.priority])}>{TICKET_PRIORITY_LABEL[t.priority]}</span>}
            {atrasado && <span className="text-[11px] rounded-full px-2 py-0.5 bg-danger-soft text-danger-ink">prazo vencido</span>}
          </span>
          <span className="block text-xs text-muted truncate">
            {t.department && <span style={{ color: t.department.color }}>● </span>}{t.department?.name ?? 'Sem setor'}
            {' · '}{t.responsible ? t.responsible.name : 'sem responsável'}{outros.length > 0 && ` +${outros.length}`}
            {t.hold && ` · ${t.hold.reason?.name ?? 'em espera'}${t.hold.until ? ` (retomar ${dia(t.hold.until)})` : ''}`}
            {t.dueAt && !t.hold && ` · prazo ${dia(t.dueAt)}`}
          </span>
        </span>
        <span className="text-[11px] text-faint whitespace-nowrap shrink-0 text-right">
          {quando(t.updatedAt)}
          {t.comments > 0 && <span className="block"><MessageSquare size={11} className="inline" /> {t.comments}</span>}
        </span>
      </button>
    </li>
  );
}

/** Pessoas: responsável (um) + participantes (quantos precisar — adm, portaria, concierge…). */
function SeletorPessoas({ opts, responsavel, participantes, onResponsavel, onParticipantes, setor }: {
  opts: TicketOptions; responsavel: string; participantes: string[]; setor: string;
  onResponsavel: (id: string) => void; onParticipantes: (ids: string[]) => void;
}) {
  // quem é do setor escolhido aparece primeiro
  const ordem = useMemo(() => [...opts.users].sort((a, b) => Number(b.departmentIds.includes(setor)) - Number(a.departmentIds.includes(setor)) || a.name.localeCompare(b.name)), [opts.users, setor]);
  const livres = ordem.filter((u) => u.id !== responsavel && !participantes.includes(u.id));
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label="Responsável">
        <select className={inputCls} value={responsavel} onChange={(e) => { onResponsavel(e.target.value); onParticipantes(participantes.filter((p) => p !== e.target.value)); }}>
          <option value="">Ninguém ainda (o setor assume)</option>
          {ordem.map((u) => <option key={u.id} value={u.id}>{u.name}{setor && u.departmentIds.includes(setor) ? ' · do setor' : ''}</option>)}
        </select>
      </Field>
      <Field label="Atuam junto">
        <div className="space-y-1.5">
          {participantes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {participantes.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-field px-2 py-0.5 text-xs">
                  {opts.users.find((u) => u.id === id)?.name ?? '—'}
                  <button type="button" onClick={() => onParticipantes(participantes.filter((p) => p !== id))} aria-label="Tirar"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <select className={inputCls} value="" onChange={(e) => e.target.value && onParticipantes([...participantes, e.target.value])}>
            <option value="">＋ Incluir pessoa…</option>
            {livres.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </Field>
    </div>
  );
}

function NovoTicket({ opts, onClose, onCriado }: { opts: TicketOptions; onClose: () => void; onCriado: (id: string) => void }) {
  const w = useTicketWrite();
  const conversa = useUI((s) => s.conversationId);
  const [f, setF] = useState({ title: '', description: '', priority: 'normal' as TicketPriority, departmentId: '', responsibleId: '', participantIds: [] as string[], dueAt: '', vincular: false });
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await w.mutateAsync({
        path: '', body: {
          title: f.title, description: f.description || undefined, priority: f.priority, departmentId: f.departmentId || undefined,
          responsibleId: f.responsibleId || undefined, participantIds: f.participantIds, dueAt: f.dueAt ? fimDoDia(f.dueAt) : undefined,
          ...(f.vincular && conversa && { conversationId: conversa }),
        },
      });
      toast.ok('Ticket aberto');
      if ('id' in r) onCriado(r.id);
    } catch (err) { toast.err(err); }
  }
  return (
    <Modal open onClose={onClose} title="Novo ticket" width="max-w-2xl">
      <form onSubmit={salvar} className="space-y-3">
        <Field label="O que precisa"><input className={inputCls} value={f.title} maxLength={TICKET_TITLE_MAX} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex.: Trocar lâmpada do hall do bloco B" required minLength={3} autoFocus /></Field>
        <Field label="Detalhes"><textarea className={cn(inputCls, 'min-h-[5rem]')} value={f.description} maxLength={TICKET_TEXT_MAX} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Onde, quem pediu, o que já foi feito…" /></Field>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Setor">
            <select className={inputCls} value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>
              <option value="">Sem setor</option>
              {opts.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Prioridade">
            <select className={inputCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TicketPriority })}>
              {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p]}</option>)}
            </select>
          </Field>
          <Field label="Prazo"><DateInput value={f.dueAt} min={hojeYmd()} clearable onChange={(dueAt) => setF({ ...f, dueAt })} aria-label="Prazo" /></Field>
        </div>
        <SeletorPessoas opts={opts} setor={f.departmentId} responsavel={f.responsibleId} participantes={f.participantIds}
          onResponsavel={(responsibleId) => setF((x) => ({ ...x, responsibleId }))} onParticipantes={(participantIds) => setF((x) => ({ ...x, participantIds }))} />
        <p className="text-[11px] text-faint">Sem responsável, o ticket fica para quem atende o setor. Quem você incluir recebe o aviso na hora.</p>
        {conversa && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.vincular} onChange={(e) => setF({ ...f, vincular: e.target.checked })} /> Ligar ao atendimento aberto nas conversas</label>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={w.isPending}>Abrir ticket</Button></div>
      </form>
    </Modal>
  );
}

type Acao = null | 'espera' | 'transferir' | 'pessoa';

function Detalhe({ id, opts, onClose }: { id: string; opts: TicketOptions; onClose: () => void }) {
  const q = useTicket(id);
  const w = useTicketWrite();
  const me = useMe().data;
  const gestao = useCan('tickets.manage');
  const setConversation = useUI((s) => s.setConversation);
  const [acao, setAcao] = useState<Acao>(null);
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
          <Chip status={t.status} />
          <span className={PRIO_CLS[t.priority]}>Prioridade {TICKET_PRIORITY_LABEL[t.priority].toLowerCase()}</span>
          <span className="text-muted">· {t.department?.name ?? 'Sem setor'}</span>
          {t.dueAt && <span className="text-muted">· prazo {dia(t.dueAt)}</span>}
          <span className="text-faint">· aberto por {t.createdBy?.name ?? '—'} em {quando(t.createdAt)}</span>
          {t.conversation && (
            <Link href="/conversas" onClick={() => setConversation(t.conversation!.id)} className="text-accent-ink hover:underline inline-flex items-center gap-1">
              <MessageSquare size={12} /> {t.conversation.contact.name ?? t.conversation.contact.phone}
            </Link>
          )}
        </div>

        {t.hold && (
          <div className="rounded-lg bg-warn-soft text-warn-ink px-3 py-2 text-sm">
            <b>Em espera:</b> {t.hold.reason?.name ?? '—'}{t.hold.since && <span className="text-xs"> desde {quando(t.hold.since)}</span>}
            {t.hold.until && <span className={cn('text-xs', new Date(t.hold.until) < new Date() && 'font-semibold')}> · retomar em {dia(t.hold.until)}{new Date(t.hold.until) < new Date() && ' (passou)'}</span>}
            {t.hold.note && <p className="text-xs mt-0.5">{t.hold.note}</p>}
          </div>
        )}

        {t.description && <p className="text-sm text-ink whitespace-pre-wrap rounded-lg bg-field px-3 py-2">{t.description}</p>}

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
            <Button size="sm" variant="success" icon={<CheckCircle2 size={13} />} onClick={() => { const note = prompt('O que foi feito? (opcional)') ?? undefined; void fazer('/status', { status: 'resolved', note }, 'Ticket resolvido'); }}>Resolver</Button>
          </div>
        )}
        {!encerrado && (gestao || dono) && t.status !== 'resolved' && (
          <button type="button" className="text-xs text-danger-ink hover:underline inline-flex items-center gap-1" onClick={() => { const note = prompt('Por que cancelar? (opcional)'); if (note !== null) void fazer('/status', { status: 'canceled', note }, 'Ticket cancelado'); }}><Ban size={12} /> Cancelar ticket</button>
        )}
        {encerrado && (t.canAct || dono) && <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => fazer('/status', { status: t.responsible ? 'in_progress' : 'open' }, 'Ticket reaberto')}>Reabrir</Button>}

        {acao === 'espera' && <CongelarForm opts={opts} onCancel={() => setAcao(null)} onSalvar={(b) => fazer('/hold', b, 'Ticket em espera').then(() => setAcao(null))} loading={w.isPending} />}
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
  const quem = e.actor?.name ?? 'Sistema';
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
      case 'edited': return `editou ${(d.fields as string[] | undefined)?.map((f) => ({ title: 'o título', description: 'a descrição', priority: 'a prioridade', dueAt: 'o prazo' } as Record<string, string>)[f] ?? f).join(', ')}`;
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
