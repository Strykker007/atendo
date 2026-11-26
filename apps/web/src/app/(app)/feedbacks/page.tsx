'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClipboardCheck, MessageSquareReply, Search, X } from 'lucide-react';
import { REVIEW_KINDS, REVIEW_KIND_LABEL, type AttendanceReview, type ReviewKind } from '@atendo/shared';
import { Empty, PageHeader, PageShell } from '@/components/ui/Page';
import { KIND_STYLE, KindBadge, ReviewDetailModal, StatusLine } from '@/components/feedback/Feedback';
import { useAgents, useCan, useDebounced, useMyReviews, useTeamReviews } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/**
 * Feedbacks (docs/feedback-de-atendimento.md): "Recebidos" é de todo mundo (os seus, para dar
 * ciência). Com `reviews.manage`: "Enviados" (os que eu apontei) e "Da equipe" (de todos os gestores).
 * `?abrir=<id>` abre um direto (cartão do aviso, tela de pendências).
 */
export default function FeedbacksPage() {
  return <Suspense><FeedbacksInner /></Suspense>;
}

function FeedbacksInner() {
  const params = useSearchParams();
  const router = useRouter();
  const gestor = useCan('reviews.manage');
  // aviso de ciência/resposta/prazo chega para quem enviou: abre em Enviados
  const [aba, setAba] = useState<'mine' | 'sent' | 'team'>(params.get('aba') === 'enviados' ? 'sent' : params.get('aba') === 'equipe' ? 'team' : 'mine');
  const [aberto, setAberto] = useState<string | null>(params.get('abrir'));
  useEffect(() => { const id = params.get('abrir'); if (id) setAberto(id); }, [params]);
  const fechar = () => { setAberto(null); if (params.get('abrir')) router.replace('/feedbacks'); };

  return (
    <PageShell width="max-w-4xl">
      <PageHeader title="Feedbacks" subtitle="Correções, oportunidades, orientações e elogios do gestor sobre atendimentos. Só você e a gestão veem." />
      {gestor && (
        <div className="inline-grid grid-cols-3 rounded-lg bg-field p-0.5 text-[12.5px] font-semibold">
          {([['mine', 'Recebidos'], ['sent', 'Enviados'], ['team', 'Da equipe']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setAba(k)} className={cn('rounded-md px-4 py-1.5', aba === k ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink')}>{l}</button>
          ))}
        </div>
      )}
      {aba === 'mine' || !gestor ? <Recebidos onOpen={setAberto} /> : <DaEquipe key={aba} enviados={aba === 'sent'} onOpen={setAberto} />}
      {aberto && <ReviewDetailModal id={aberto} onClose={fechar} />}
    </PageShell>
  );
}

function Recebidos({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useMyReviews();
  const [f, setF] = useState<Filtros>(FILTRO_VAZIO);
  const todos = q.data ?? [];
  // os recebidos vêm todos (até 200): filtrar aqui é instantâneo
  const lista = todos.filter((r) => casa(r, f));
  const pendentes = lista.filter((r) => r.status !== 'acknowledged');
  const resto = lista.filter((r) => r.status === 'acknowledged');
  if (q.isLoading) return <p className="text-sm text-muted">Carregando…</p>;
  if (!todos.length) return <Empty icon={<ClipboardCheck size={36} />} title="Nenhum feedback" text="Quando o gestor comentar um atendimento seu, aparece aqui." />;
  return (
    <div className="space-y-4">
      <BarraFiltros f={f} onChange={setF} />
      {!lista.length && <SemResultado onLimpar={() => setF(FILTRO_VAZIO)} />}
      {pendentes.length > 0 && <Secao titulo={`Para dar ciência (${pendentes.length})`} itens={pendentes} onOpen={onOpen} destaque />}
      {resto.length > 0 && <Secao titulo="Anteriores" itens={resto} onOpen={onOpen} />}
    </div>
  );
}

type Periodo = 'all' | '7' | '30' | '90' | 'custom';
interface Filtros { busca: string; kind: ReviewKind | ''; periodo: Periodo; de: string; ate: string }
const FILTRO_VAZIO: Filtros = { busca: '', kind: '', periodo: 'all', de: '', ate: '' };
const ativos = (f: Filtros) => (f.busca.trim() ? 1 : 0) + (f.kind ? 1 : 0) + (f.periodo !== 'all' ? 1 : 0);

/** período → [início, fim) em ISO; vazio = sem limite */
function intervalo(f: Filtros): { from?: string; to?: string } {
  if (f.periodo === 'all') return {};
  if (f.periodo === 'custom') {
    return {
      ...(f.de && { from: new Date(`${f.de}T00:00:00`).toISOString() }),
      ...(f.ate && { to: new Date(new Date(`${f.ate}T00:00:00`).getTime() + 86_400_000).toISOString() }),
    };
  }
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - Number(f.periodo) + 1);
  return { from: d.toISOString() };
}
const dobrar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function casa(r: AttendanceReview, f: Filtros) {
  if (f.kind && r.kind !== f.kind) return false;
  const { from, to } = intervalo(f);
  if (from && r.createdAt < from) return false;
  if (to && r.createdAt >= to) return false;
  const q = dobrar(f.busca.trim());
  if (q && ![r.text, r.contact.name ?? '', r.contact.phone, r.reviewer.name, r.agent.name].some((x) => dobrar(x).includes(q))) return false;
  return true;
}

/** Busca, tipo e período: os mesmos nas três abas (em Enviados/Da equipe vão para a API). */
function BarraFiltros({ f, onChange, children }: { f: Filtros; onChange: (f: Filtros) => void; children?: React.ReactNode }) {
  const mudar = (p: Partial<Filtros>) => onChange({ ...f, ...p });
  return (
    <div className="rounded-2xl border border-line bg-panel p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 rounded-lg bg-field px-2.5 h-8 flex-1 min-w-[200px]">
          <Search size={14} className="text-faint shrink-0" />
          <input value={f.busca} onChange={(e) => mudar({ busca: e.target.value })} placeholder="Buscar por contato, telefone, atendente ou texto…" className="bg-transparent text-[13px] w-full focus:outline-none" />
          {f.busca && <button type="button" onClick={() => mudar({ busca: '' })} aria-label="Limpar busca" className="text-faint hover:text-ink"><X size={13} /></button>}
        </label>
        <select value={f.periodo} onChange={(e) => mudar({ periodo: e.target.value as Periodo })} aria-label="Período"
          className={cn('rounded-lg bg-field text-ink px-2.5 h-8 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-accent/40', f.periodo !== 'all' && 'ring-1 ring-accent')}>
          <option value="all">Qualquer data</option>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="custom">Escolher datas…</option>
        </select>
        {f.periodo === 'custom' && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <input type="date" value={f.de} onChange={(e) => mudar({ de: e.target.value })} className="rounded-lg bg-field text-ink px-2 h-8 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40" aria-label="De" />
            até
            <input type="date" value={f.ate} onChange={(e) => mudar({ ate: e.target.value })} className="rounded-lg bg-field text-ink px-2 h-8 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40" aria-label="Até" />
          </span>
        )}
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => mudar({ kind: '' })} className={chip(!f.kind)}>Todos os tipos</button>
        {REVIEW_KINDS.map((k) => (
          <button key={k} type="button" onClick={() => mudar({ kind: f.kind === k ? '' : k })} className={cn(chip(f.kind === k), 'inline-flex items-center gap-1')}>
            {KIND_STYLE[k].icon}{REVIEW_KIND_LABEL[k]}
          </button>
        ))}
        {ativos(f) > 0 && <button type="button" onClick={() => onChange(FILTRO_VAZIO)} className="ml-auto text-[11.5px] text-accent-ink hover:underline">Limpar filtros</button>}
      </div>
    </div>
  );
}
const chip = (on: boolean) => cn('text-[11.5px] font-semibold px-2.5 py-1 rounded-md border transition-colors', on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field');

function SemResultado({ onLimpar }: { onLimpar: () => void }) {
  return <p className="rounded-2xl border border-dashed border-line bg-panel p-8 text-center text-sm text-muted">Nenhum feedback com esses filtros. <button type="button" onClick={onLimpar} className="text-accent-ink hover:underline">Limpar filtros</button></p>;
}

/**
 * Enviados: os que EU apontei, todos por padrão (é consulta). Da equipe: de todos os gestores,
 * começando nos sem ciência (é cobrança).
 */
function DaEquipe({ onOpen, enviados }: { onOpen: (id: string) => void; enviados: boolean }) {
  const [agentId, setAgentId] = useState('');
  const [status, setStatus] = useState<'all' | 'pending' | 'overdue' | 'acknowledged'>(enviados ? 'all' : 'pending');
  const [f, setF] = useState<Filtros>(FILTRO_VAZIO);
  const busca = useDebounced(f.busca.trim(), 350);
  const agents = useAgents();
  const q = useTeamReviews({ agentId: agentId || undefined, status, reviewer: enviados ? 'me' : undefined, kind: f.kind || undefined, search: busca || undefined, ...intervalo(f) });
  const contagem = (st: string) => (q.data && status === 'all' ? q.data.filter((r) => (st === 'pending' ? r.requiresAck && r.status !== 'acknowledged' : st === 'overdue' ? r.status === 'overdue' : r.status === 'acknowledged')).length : null);
  const lista = q.data ?? [];
  const algumFiltro = ativos(f) > 0 || !!agentId || status !== (enviados ? 'all' : 'pending');
  return (
    <div className="space-y-3">
      <BarraFiltros f={f} onChange={setF}>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Atendente"
          className={cn('rounded-lg bg-field text-ink px-2.5 h-8 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-accent/40', agentId && 'ring-1 ring-accent')}>
          <option value="">Toda a equipe</option>
          {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isActive ? '' : ' (inativo)'}</option>)}
        </select>
      </BarraFiltros>
      <div className="flex flex-wrap items-center gap-1">
        {([['pending', 'Sem ciência'], ['overdue', 'Prazo vencido'], ['acknowledged', 'Cientes'], ['all', 'Todos']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} className={chip(status === k)}>
            {l}{k !== 'all' && contagem(k) !== null ? <span className="ml-1 tnum opacity-70">{contagem(k)}</span> : null}
          </button>
        ))}
        {q.data && <span className="ml-auto text-[11.5px] text-faint tnum">{lista.length === 300 ? 'Mostrando os 300 mais recentes' : `${lista.length} feedback(s)`}</span>}
      </div>
      {q.isLoading ? <p className="text-sm text-muted">Carregando…</p>
        : !lista.length && algumFiltro ? <SemResultado onLimpar={() => { setF(FILTRO_VAZIO); setAgentId(''); setStatus(enviados ? 'all' : 'pending'); }} />
        : !lista.length ? <Empty icon={<ClipboardCheck size={36} />} title={enviados ? 'Você ainda não enviou feedback' : 'Nada por aqui'} text="Abra a conversa e, na linha “Atendimento encerrado”, clique em Dar feedback — ou pela auditoria em Relatórios." />
        : <Secao itens={lista} onOpen={onOpen} gestor enviados={enviados} />}
    </div>
  );
}

function Secao({ titulo, itens, onOpen, destaque, gestor, enviados }: { titulo?: string; itens: AttendanceReview[]; onOpen: (id: string) => void; destaque?: boolean; gestor?: boolean; enviados?: boolean }) {
  return (
    <section className="space-y-2">
      {titulo && <h2 className="text-[11px] font-semibold uppercase tracking-wider text-faint">{titulo}</h2>}
      <ul className="space-y-2">
        {itens.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onOpen(r.id)}
              className={cn('w-full text-left rounded-2xl border bg-panel px-4 py-3 hover:bg-field transition-colors', destaque && r.blocksClaim ? 'border-danger/50' : 'border-line')}>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted">
                <KindBadge kind={r.kind} />
                <span>{gestor ? <>para <b className="text-ink">{r.agent.name}</b>{enviados ? '' : ` · de ${r.reviewer.name}`}</> : <>de <b className="text-ink">{r.reviewer.name}</b></>}</span>
                <span>· {r.contact.name || r.contact.phone}</span>
                <span className="tnum">· {new Date(r.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                {r.agentReply && <span className="inline-flex items-center gap-1 text-accent-ink"><MessageSquareReply size={12} />respondeu</span>}
              </div>
              <p className="mt-1.5 text-[13.5px] text-ink line-clamp-2">{r.text}</p>
              <div className="mt-1.5"><StatusLine r={r} gestor={gestor} /></div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
