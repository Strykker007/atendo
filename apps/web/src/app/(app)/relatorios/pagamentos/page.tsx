'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Search, MessageSquare, Copy, FileText, Zap, ChevronLeft, ChevronRight } from 'lucide-react';
import { BUDGET_STATUS_LABEL, type BudgetStatus } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { inputCls } from '@/components/ui/Modal';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { budgetLink, useAgents, useAllBudgets, useCan, type BudgetListRow } from '@/lib/hooks';
import { useUI } from '@/lib/store';

/**
 * Relatórios → Pagamentos (docs/orcamentos.md#relatório-de-pagamentos): onde a equipe confere o que
 * foi pago, o que espera pagamento, o que venceu e o que foi estornado — sem abrir conversa por
 * conversa. É acompanhamento, não onde se cria orçamento (isso é no chat), por isso mora em Relatórios.
 * Os cartões do topo são os totais do período (e filtram ao clicar).
 */

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** início do dia local → ISO (a API recebe instantes; `to` exclusivo = início do dia seguinte) */
const inicio = (dia: string) => new Date(`${dia}T00:00:00`).toISOString();
const diaSeguinte = (dia: string) => { const d = new Date(`${dia}T00:00:00`); d.setDate(d.getDate() + 1); return d.toISOString(); };

const PERIODOS = [
  { id: 'hoje', label: 'Hoje', de: () => ymd(new Date()) },
  { id: '7d', label: '7 dias', de: () => { const d = new Date(); d.setDate(d.getDate() - 6); return ymd(d); } },
  { id: 'mes', label: 'Este mês', de: () => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), 1)); } },
] as const;

const CARTOES: { status: BudgetStatus; cls: string }[] = [
  { status: 'PAID', cls: 'text-ok' },
  { status: 'PENDING', cls: 'text-warn-ink' },
  { status: 'EXPIRED', cls: 'text-muted' },
  { status: 'REFUNDED', cls: 'text-danger-ink' },
];
const STATUS_CLS: Record<BudgetStatus, string> = {
  PENDING: 'bg-warn-soft text-warn-ink',
  PAID: 'bg-ok-soft text-ok',
  EXPIRED: 'bg-field text-muted',
  REFUNDED: 'bg-danger-soft text-danger-ink',
};

export default function PagamentosPage() {
  const router = useRouter();
  const { setConversation } = useUI();
  const podeVer = useCan('reports.view');
  const verEquipe = useCan('conversations.view_all');
  const agents = useAgents();
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]['id'] | 'custom'>('hoje');
  const [de, setDe] = useState(ymd(new Date()));
  const [ate, setAte] = useState(ymd(new Date()));
  const [status, setStatus] = useState<BudgetStatus | ''>('');
  const [via, setVia] = useState<'' | 'auto' | 'fora'>('');
  const [userId, setUserId] = useState('');
  const [busca, setBusca] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => { const t = setTimeout(() => setSearch(busca.trim()), 350); return () => clearTimeout(t); }, [busca]);
  useEffect(() => setPage(1), [de, ate, status, via, userId, search]);
  const escolherPeriodo = (id: (typeof PERIODOS)[number]['id']) => { setPeriodo(id); setDe(PERIODOS.find((p) => p.id === id)!.de()); setAte(ymd(new Date())); };

  const q = useAllBudgets({ from: inicio(de), to: diaSeguinte(ate), status: status || undefined, via: via || undefined, userId: userId || undefined, search: search || undefined, page });
  const d = q.data;
  const paginas = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  const abrir = (r: BudgetListRow) => { setConversation(r.conversationId); router.push('/conversas'); };
  const copiar = (hash: string) => navigator.clipboard.writeText(budgetLink(hash)).then(() => toast.ok('Link copiado'), toast.err);

  if (!podeVer) return <PageShell><p className="text-sm text-muted">Seu perfil de acesso não inclui relatórios.</p></PageShell>;
  return (
    <PageShell width="max-w-6xl">
      <PageHeader
        title="Pagamentos"
        subtitle={verEquipe ? 'Orçamentos pagos, aguardando, vencidos e estornados da equipe.' : 'Os orçamentos que você gerou: pagos, aguardando, vencidos e estornados.'}
        action={<Link href="/relatorios" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Relatórios</Link>}
      />

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <div className="inline-flex rounded-lg border border-line p-0.5 text-[12.5px]">
          {PERIODOS.map((p) => (
            <button key={p.id} type="button" onClick={() => escolherPeriodo(p.id)} aria-pressed={periodo === p.id} className={cn('rounded-md px-2.5 py-1 font-medium', periodo === p.id ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:text-ink')}>{p.label}</button>
          ))}
        </div>
        <input type="date" className={cn(inputCls, 'w-auto py-1.5 text-[12.5px]')} value={de} max={ate} onChange={(e) => { if (e.target.value) { setDe(e.target.value); setPeriodo('custom'); } }} aria-label="De" />
        <span className="text-muted text-sm">até</span>
        <input type="date" className={cn(inputCls, 'w-auto py-1.5 text-[12.5px]')} value={ate} min={de} onChange={(e) => { if (e.target.value) { setAte(e.target.value); setPeriodo('custom'); } }} aria-label="Até" />
        <select className={cn(inputCls, 'w-auto py-1.5 text-[12.5px]')} value={via} onChange={(e) => setVia(e.target.value as typeof via)} aria-label="Forma de pagamento">
          <option value="">Toda forma de pagamento</option>
          <option value="auto">Pix automático (Asaas)</option>
          <option value="fora">Por fora (chave / link)</option>
        </select>
        {verEquipe && (
          <select className={cn(inputCls, 'w-auto py-1.5 text-[12.5px]')} value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Atendente">
            <option value="">Toda a equipe</option>
            {(agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.isActive ? '' : ' (inativo)'}</option>)}
          </select>
        )}
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className={cn(inputCls, 'pl-8 py-1.5 text-[12.5px]')} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Contato ou número" aria-label="Buscar contato ou número" />
        </div>
      </div>

      {/* totais do período: cada cartão filtra a tabela */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mt-4">
        {CARTOES.map(({ status: s, cls }) => {
          const t = d?.totals.byStatus[s];
          const ativo = status === s;
          return (
            <button key={s} type="button" onClick={() => setStatus(ativo ? '' : s)} aria-pressed={ativo}
              className={cn('rounded-2xl border bg-panel p-4 text-left transition-colors', ativo ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:bg-field')}>
              <div className="text-[12px] text-muted">{BUDGET_STATUS_LABEL[s]}</div>
              <div className={cn('text-xl font-semibold tnum mt-0.5', cls)}>{brl(t?.value ?? 0)}</div>
              <div className="text-[11.5px] text-faint tnum">{t?.count ?? 0} orçamento(s)</div>
              {s === 'PAID' && d && (
                <div className="mt-1.5 text-[11px] text-muted space-y-0.5">
                  <div className="flex justify-between gap-2"><span className="inline-flex items-center gap-1"><Zap size={11} className="text-ok" /> Pix automático</span><span className="tnum">{brl(d.totals.paidByVia.asaas?.value ?? 0)}</span></div>
                  <div className="flex justify-between gap-2"><span>Por fora</span><span className="tnum">{brl(d.totals.paidByVia.manual?.value ?? 0)}</span></div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className={cn('mt-4 rounded-2xl bg-panel border border-line overflow-hidden', q.isFetching && 'opacity-70')}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-4 py-2 font-medium">Gerado em</th>
                <th className="px-4 py-2 font-medium">Contato</th>
                {verEquipe && <th className="px-4 py-2 font-medium">Atendente</th>}
                <th className="px-4 py-2 font-medium">Itens</th>
                <th className="px-4 py-2 font-medium text-right">Valor</th>
                <th className="px-4 py-2 font-medium">Forma</th>
                <th className="px-4 py-2 font-medium">Situação</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {q.isLoading && <tr><td colSpan={8} className="p-4"><SkeletonRows rows={4} /></td></tr>}
              {d && d.rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">Nenhum orçamento com esses filtros.</td></tr>}
              {d?.rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 align-top">
                  <td className="px-4 py-2.5 tnum whitespace-nowrap text-ink">{new Date(r.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td className="px-4 py-2.5"><div className="text-ink truncate max-w-[180px]">{r.contact.name || 'Sem nome'}</div><div className="text-[11px] text-muted tnum">{r.contact.phone}</div></td>
                  {verEquipe && <td className="px-4 py-2.5 text-ink truncate max-w-[140px]">{r.user.name}</td>}
                  <td className="px-4 py-2.5 text-muted"><div className="truncate max-w-[220px]">{r.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</div></td>
                  <td className="px-4 py-2.5 text-right tnum font-medium text-ink whitespace-nowrap">{brl(r.totalValue)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-[12px]">{r.autoPix ? <span className="inline-flex items-center gap-1 text-ok"><Zap size={12} /> Pix automático</span> : <span className="text-muted">Por fora</span>}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      <span className={cn('text-[11px] rounded-full px-2 py-0.5 whitespace-nowrap', STATUS_CLS[r.status])}>{BUDGET_STATUS_LABEL[r.status]}</span>
                      {r.paidAfterExpiry && <span className="text-[11px] rounded-full px-2 py-0.5 bg-warn-soft text-warn-ink whitespace-nowrap" title="Pago depois do vencimento — confira se o pedido ainda vale">Após o vencimento</span>}
                      {r.absorbed && <span className="text-[11px] rounded-full px-2 py-0.5 bg-field text-muted whitespace-nowrap" title="Já entrou num encerramento como venda">No encerramento</span>}
                      {r.receipt && <span className="text-[11px] rounded-full px-2 py-0.5 bg-accent-soft text-accent-ink whitespace-nowrap">Comprovante</span>}
                    </div>
                    <div className="text-[11px] text-faint mt-0.5 tnum">
                      {r.status === 'PAID' && r.paidAt ? `pago ${new Date(r.paidAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
                        : r.status === 'REFUNDED' && r.refundedAt ? `estornado ${new Date(r.refundedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
                        : `vence ${new Date(r.expiresAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1 justify-end">
                      {r.receipt && <a href={r.receipt.url} target="_blank" rel="noreferrer" title="Ver comprovante" className="p-1.5 rounded-md text-faint hover:text-ink hover:bg-field"><FileText size={14} /></a>}
                      <button type="button" title="Copiar link" onClick={() => copiar(r.hash)} className="p-1.5 rounded-md text-faint hover:text-ink hover:bg-field"><Copy size={14} /></button>
                      <button type="button" title="Abrir conversa" onClick={() => abrir(r)} className="p-1.5 rounded-md text-faint hover:text-ink hover:bg-field"><MessageSquare size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {d && paginas > 1 && (
        <div className="flex items-center justify-end gap-2 mt-3 text-[12.5px]">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-md border border-line disabled:opacity-40" aria-label="Página anterior"><ChevronLeft size={14} /></button>
          <span className="text-muted tnum">{page} / {paginas}</span>
          <button type="button" disabled={page >= paginas} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-md border border-line disabled:opacity-40" aria-label="Próxima página"><ChevronRight size={14} /></button>
        </div>
      )}
    </PageShell>
  );
}
