'use client';
import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Package, DollarSign, Receipt, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/ui/Modal';
import { fmtBRL } from '@/components/reports/ReportChart';
import { useSaleDetails } from '@/lib/hooks';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
type Periodo = 'hoje' | '7' | '30' | 'custom';
const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7', label: '7 dias' },
  { id: '30', label: '30 dias' },
  { id: 'custom', label: 'Personalizado' },
];
const rangeDe = (p: Exclude<Periodo, 'custom'>): [string, string] => {
  const amanha = iso(addDays(new Date(), 1));
  return [iso(addDays(new Date(), p === 'hoje' ? 0 : -(Number(p) - 1))), amanha];
};
const PAGE_SIZE = 25;

/**
 * Detalhamento de vendas: lista da tabela `sales` com filtro por período, atendente e busca
 * (cliente, número ou produto). O resumo do topo vale para o filtro inteiro, não só a página.
 */
export function SalesDetails() {
  const [periodo, setPeriodo] = useState<Periodo>('30');
  const [range, setRange] = useState<[string, string]>(rangeDe('30'));
  const [userId, setUserId] = useState('');
  const [busca, setBusca] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [aberta, setAberta] = useState<string | null>(null);

  // espera o usuário parar de digitar antes de consultar
  useEffect(() => {
    const t = setTimeout(() => setSearch(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);
  // filtro novo = volta para a primeira página
  useEffect(() => setPage(1), [range, userId, search]);

  const q = useSaleDetails({ startDate: range[0], endDate: range[1], userId: userId || undefined, search: search || undefined, page, pageSize: PAGE_SIZE });
  const d = q.data;
  const paginas = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink">Detalhamento de vendas</h2>
        <p className="text-[12px] text-muted">Cada venda encerrada como Comprou, com cliente, atendente e itens.</p>
      </div>

      {/* filtros */}
      <div className="rounded-2xl bg-panel border border-line p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input className={cn(inputCls, 'pl-9')} placeholder="Buscar por cliente, número ou produto" value={busca} onChange={(e) => setBusca(e.target.value)} maxLength={120} />
          </div>
          <select className={cn(inputCls, '!w-48')} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Todos os atendentes</option>
            {d?.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="flex flex-wrap gap-1">
            {PERIODOS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setPeriodo(p.id); if (p.id !== 'custom') setRange(rangeDe(p.id)); }}
                className={cn('text-xs font-semibold px-2.5 py-1.5 rounded-lg border', periodo === p.id ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {periodo === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className={cn(inputCls, '!w-40')} value={range[0]} onChange={(e) => e.target.value && setRange([e.target.value, range[1]])} />
            <span className="text-xs text-muted">até</span>
            <input type="date" className={cn(inputCls, '!w-40')} value={iso(addDays(new Date(range[1]), -1))} onChange={(e) => e.target.value && setRange([range[0], iso(addDays(new Date(e.target.value), 1))])} />
          </div>
        )}
      </div>

      {/* resumo do filtro ativo */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Resumo icon={<Package size={15} />} label="Produtos vendidos" value={d ? d.summary.itemsSold.toLocaleString('pt-BR') : '—'} sub={d ? `em ${d.summary.count} venda${d.summary.count === 1 ? '' : 's'}` : undefined} />
        <Resumo icon={<DollarSign size={15} />} label="Faturamento do filtro" value={d ? fmtBRL(d.summary.revenue) : '—'} />
        <Resumo icon={<Receipt size={15} />} label="Ticket médio" value={d?.summary.avgTicket != null ? fmtBRL(d.summary.avgTicket) : '—'} sub="faturado ÷ vendas" />
      </div>

      {/* lista */}
      <div className={cn('rounded-2xl bg-panel border border-line overflow-hidden', q.isFetching && 'opacity-70')}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-4 py-2 font-medium">Data/hora</th>
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Atendente</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {q.isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Carregando…</td></tr>}
              {d && d.rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Nenhuma venda com esses filtros.</td></tr>}
              {d?.rows.map((s) => {
                const on = aberta === s.id;
                return (
                  <Fragment key={s.id}>
                    <tr onClick={() => setAberta(on ? null : s.id)} className={cn('border-b border-line cursor-pointer hover:bg-field', on && 'bg-field')}>
                      <td className="px-4 py-2.5 tnum whitespace-nowrap text-ink">{new Date(s.closedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-ink truncate max-w-[220px]">{s.contact.name || 'Sem nome'}</div>
                        <div className="text-[11px] text-muted tnum">{s.contact.phoneFormatted}</div>
                      </td>
                      <td className="px-4 py-2.5 text-ink truncate max-w-[160px]">{s.user?.name ?? <span className="text-muted">(sem atendente)</span>}</td>
                      <td className="px-4 py-2.5 text-right tnum font-medium text-ink whitespace-nowrap">{fmtBRL(s.amount)}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-accent">
                          Ver itens ({s.items.length}) <ChevronDown size={14} className={cn('transition-transform', on && 'rotate-180')} />
                        </span>
                      </td>
                    </tr>
                    {on && (
                      <tr className="border-b border-line bg-field/50">
                        <td colSpan={5} className="px-4 py-3">
                          <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
                            {s.items.map((i, n) => (
                              <li key={n} className="flex items-center justify-between gap-4 px-3 py-2">
                                <span className="text-ink min-w-0 break-words">{i.description || <span className="text-muted">(sem descrição)</span>}</span>
                                <span className="tnum text-ink shrink-0">{fmtBRL(i.value)}</span>
                              </li>
                            ))}
                          </ul>
                          {s.notes && <p className="mt-2 text-[12px] text-muted"><b className="font-medium">Observações:</b> {s.notes}</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {d && d.total > d.pageSize && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-line text-xs text-muted">
            <span className="tnum">{(d.page - 1) * d.pageSize + 1}–{Math.min(d.page * d.pageSize, d.total)} de {d.total}</span>
            <div className="flex items-center gap-1">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-md hover:bg-field disabled:opacity-40" aria-label="Página anterior"><ChevronLeft size={15} /></button>
              <span className="tnum">{page} / {paginas}</span>
              <button type="button" disabled={page >= paginas} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-md hover:bg-field disabled:opacity-40" aria-label="Próxima página"><ChevronRight size={15} /></button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Resumo({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-panel border border-line p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted">{icon}{label}</div>
      <div className="text-2xl font-semibold tnum mt-1 text-ink">{value}</div>
      {sub && <div className="text-[11px] text-faint mt-0.5">{sub}</div>}
    </div>
  );
}
