'use client';
import { useMemo, useState } from 'react';
import { Download, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { useClientCosts, type ClientCostRow } from '@/lib/hooks';
import { csvNum, downloadCsv } from '@/lib/csv';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)}%`);
const mesBR = (p: string) => { const [y, m] = p.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); };
const STATUS: Record<string, string> = { active: 'Ativo', trialing: 'Em teste', past_due: 'Atrasado', suspended: 'Suspenso', canceled: 'Cancelado' };

type Filtro = 'todos' | 'prejuizo' | 'baixa' | 'parceiro';

/**
 * Custo e margem por cliente (docs/36-fechamento-financeiro.md#custo-por-cliente). Nada é digitado
 * por cliente: infra, impostos e taxas vêm do que foi lançado no Fechamento e são divididos sozinhos.
 */
export function ClientCostsTab({ period }: { period: string }) {
  const q = useClientCosts(period);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const d = q.data;

  const rows = useMemo(() => {
    const all = d?.rows ?? [];
    const t = busca.trim().toLowerCase();
    return all.filter((r) =>
      (!t || r.name.toLowerCase().includes(t) || (r.partner ?? '').toLowerCase().includes(t)) &&
      (filtro === 'todos' || (filtro === 'prejuizo' && r.margin < 0) || (filtro === 'baixa' && r.marginPct !== null && r.marginPct >= 0 && r.marginPct < 30) || (filtro === 'parceiro' && !!r.partner)));
  }, [d, filtro, busca]);

  if (q.isLoading) return <SkeletonRows rows={5} />;
  if (!d) return null;

  const exportar = () => downloadCsv(`custo-por-cliente-${period}`, [
    {
      titulo: `Custo e margem por cliente — ${mesBR(period)}`,
      head: ['Cliente', 'Situação', 'Plano', 'Parceiro', 'Números', 'Mensagens', 'Contratado', 'Recebido no mês', 'Infra', 'IA', 'Comissão parceiro', 'Comissão estimada?', 'Impostos', 'Taxas de cobrança', 'Custo do plano', 'Custo total', 'Margem', 'Margem %', 'Meta (pago pelo cliente)'],
      linhas: d.rows.map((r) => [r.name, STATUS[r.status ?? ''] ?? (r.status ?? ''), r.plan ?? '', r.partner ?? '', String(r.numbers), String(r.messagesSent), csvNum(r.contracted), csvNum(r.received), csvNum(r.infra), csvNum(r.ai), csvNum(r.commission), r.commissionEstimated ? 'sim' : '', csvNum(r.taxes), csvNum(r.fees), csvNum(r.planCost), csvNum(r.cost), csvNum(r.margin), r.marginPct === null ? '' : csvNum(r.marginPct), csvNum(r.metaInfo)]),
    },
    {
      titulo: 'Totais e rateios',
      head: ['Item', 'Valor'],
      linhas: [
        ['Recebido de clientes', csvNum(d.totals.received)],
        ['Custo atribuído aos clientes', csvNum(d.totals.cost)],
        ['Margem dos clientes', csvNum(d.totals.margin)],
        ['Infra lançada no mês', csvNum(d.pools.infra)],
        ['Infra por número', csvNum(d.pools.infraPerNumber)],
        ['Impostos lançados no mês', csvNum(d.pools.taxes)],
        ['Taxas de cobrança lançadas no mês', csvNum(d.pools.fees)],
        ['Outras entradas (sem cliente)', csvNum(d.pools.otherIncome)],
        ['Despesas gerais (folha, pró-labore, ferramentas…) não rateadas', csvNum(d.pools.generalExpenses)],
        ['Resultado aproximado (margem dos clientes + outras entradas − despesas gerais)', csvNum(d.totals.margin + d.pools.otherIncome - d.pools.generalExpenses)],
      ],
    },
  ]);

  const prejuizo = d.rows.filter((r) => r.margin < 0).length;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card label="Recebido de clientes" value={brl(d.totals.received)} />
        <Card label="Custo dos clientes" value={brl(d.totals.cost)} sub={`infra ${brl(d.totals.infra)} · IA ${brl(d.totals.ai)} · comissão ${brl(d.totals.commission)} · impostos ${brl(d.totals.taxes)}`} />
        <Card label="Margem dos clientes" value={brl(d.totals.margin)} tone={d.totals.margin >= 0 ? 'ok' : 'danger'} sub={d.totals.received ? `${((d.totals.margin / d.totals.received) * 100).toFixed(0)}% do recebido` : undefined} />
        <Card label="Clientes no prejuízo" value={String(prejuizo)} tone={prejuizo ? 'warn' : undefined} sub={`de ${d.rows.length} no mês`} />
      </div>

      <div className="rounded-xl bg-field px-4 py-3 text-xs text-muted space-y-1">
        <p className="flex items-center gap-1.5 font-semibold text-ink"><Info size={13} /> De onde vem cada custo</p>
        <p><b className="text-ink">Infra</b>: {brl(d.pools.infra)} lançados em “Servidores e infraestrutura” no Fechamento ÷ números conectados = <b className="text-ink">{brl(d.pools.infraPerNumber)}</b> por número (custo manual no número vale como exceção). <b className="text-ink">Impostos</b> ({brl(d.pools.taxes)}) e <b className="text-ink">taxas de cobrança</b> ({brl(d.pools.fees)}): divididos pelo que cada cliente pagou. <b className="text-ink">IA</b>: consumo real do mês. <b className="text-ink">Comissão</b>: VogoPartner sobre o que o cliente pagou (* = estimada pela faixa atual, ainda não apurada).</p>
        <p>Fora da conta por cliente: despesas gerais de {brl(d.pools.generalExpenses)} (folha, pró-labore, ferramentas…), pagas pelo resultado de todos. A Meta é paga por cada cliente direto; aparece só como informação. Sem lançamento de infra no mês, a infra fica zerada — lance no Fechamento para o número aparecer.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([['todos', 'Todos'], ['prejuizo', 'No prejuízo'], ['baixa', 'Margem abaixo de 30%'], ['parceiro', 'Com parceiro']] as [Filtro, string][]).map(([f, l]) => (
          <button key={f} type="button" onClick={() => setFiltro(f)} className={cn('text-xs font-semibold px-2.5 py-1.5 rounded-lg border', filtro === f ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>{l}</button>
        ))}
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente ou parceiro" className="ml-auto rounded-lg border border-line bg-panel text-ink px-3 py-1.5 text-sm w-full sm:w-56" />
        <Button size="sm" variant="ghost" icon={<Download size={14} />} disabled={!d.rows.length} onClick={exportar}>Baixar planilha</Button>
      </div>

      <div className="rounded-2xl bg-panel border border-line overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-field text-left text-xs text-muted uppercase tracking-wide">
            <tr>{['Cliente', 'Recebido', 'Infra', 'IA', 'Comissão', 'Impostos', 'Taxas', 'Plano', 'Custo', 'Margem', '%'].map((h) => <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <tr><td colSpan={11} className="px-4 py-6 text-center text-muted">Nenhum cliente neste filtro.</td></tr>}
            {rows.map((r) => <Linha key={r.tenantId} r={r} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Linha({ r }: { r: ClientCostRow }) {
  return (
    <tr className={cn(!r.isActive && 'opacity-60')}>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <div className="font-medium text-ink">{r.name}</div>
        <div className="text-[11px] text-faint">{[STATUS[r.status ?? ''] ?? r.status, r.plan, r.partner && `parceiro ${r.partner}`, `${r.numbers} nº`].filter(Boolean).join(' · ')}</div>
      </td>
      <td className="px-3 py-2.5 tnum whitespace-nowrap">{brl(r.received)}{r.received === 0 && r.contracted > 0 && <div className="text-[10px] text-warn">contratado {brl(r.contracted)}</div>}</td>
      <td className="px-3 py-2.5 tnum whitespace-nowrap" title={r.infraManual ? 'Custo manual cadastrado no número' : undefined}>{brl(r.infra)}{r.infraManual && <span className="text-faint"> ✎</span>}</td>
      <td className="px-3 py-2.5 tnum whitespace-nowrap">{brl(r.ai)}</td>
      <td className="px-3 py-2.5 tnum whitespace-nowrap">{brl(r.commission)}{r.commissionEstimated && <span className="text-warn" title="Estimada pela faixa atual: a mensalidade ainda não foi apurada">*</span>}</td>
      <td className="px-3 py-2.5 tnum whitespace-nowrap">{brl(r.taxes)}</td>
      <td className="px-3 py-2.5 tnum whitespace-nowrap">{brl(r.fees)}</td>
      <td className="px-3 py-2.5 tnum whitespace-nowrap">{brl(r.planCost)}</td>
      <td className="px-3 py-2.5 tnum whitespace-nowrap">{brl(r.cost)}</td>
      <td className={cn('px-3 py-2.5 tnum whitespace-nowrap font-semibold', r.margin >= 0 ? 'text-ok' : 'text-danger')}>{brl(r.margin)}</td>
      <td className={cn('px-3 py-2.5 tnum whitespace-nowrap', r.marginPct !== null && r.marginPct < 30 ? 'text-warn' : 'text-muted')}>{pct(r.marginPct)}</td>
    </tr>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <div className="rounded-2xl bg-panel border border-line p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn('text-xl font-semibold tnum mt-1', tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</div>
      {sub && <div className="text-[11px] text-faint mt-0.5">{sub}</div>}
    </div>
  );
}
