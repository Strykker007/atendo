'use client';
import { useState } from 'react';
import { TrendingUp, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { useMargin, useMe } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const periodOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Painel do dono do Atendo: margem por cliente. Só super_admin (a API também bloqueia). */
export default function AdminPage() {
  const me = useMe();
  const [period, setPeriod] = useState(periodOf(new Date()));
  const margin = useMargin(period);
  if (me.data && me.data.role !== 'super_admin') return <PageShell><p className="text-sm text-muted">Área restrita ao dono do sistema.</p></PageShell>;

  const rows = margin.data ?? [];
  const total = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, cost: a.cost + r.providerCost + r.infraCost, margin: a.margin + r.margin }), { revenue: 0, cost: 0, margin: 0 });
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - i); return periodOf(d); });

  return (
    <PageShell width="max-w-6xl">
      <PageHeader title="Margem por cliente" subtitle="Receita (plano + excedente) menos custo (templates Meta + rateio de infra). É aqui que se descobre plano mal precificado." action={
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-line bg-panel text-ink px-3 py-2 text-sm">{months.map((m) => <option key={m} value={m}>{m}</option>)}</select>
      } />

      <div className="grid gap-4 sm:grid-cols-3">
        {[['Receita', total.revenue, 'text-ink'], ['Custo', total.cost, 'text-ink'], ['Margem', total.margin, total.margin >= 0 ? 'text-ok' : 'text-danger']].map(([l, v, c]) => (
          <div key={l as string} className="rounded-2xl bg-panel border border-line p-5"><div className="text-xs text-muted">{l as string}</div><div className={cn('text-2xl font-semibold tnum', c as string)}>{brl(v as number)}</div></div>
        ))}
      </div>

      {margin.isLoading && <SkeletonRows rows={4} />}
      {!!rows.length && (
        <div className="rounded-2xl bg-panel border border-line overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-field text-left text-xs text-muted uppercase tracking-wide">
              <tr><th className="px-5 py-2.5">Cliente</th><th className="px-3 py-2.5">Plano</th><th className="px-3 py-2.5 text-right">Msgs</th><th className="px-3 py-2.5 text-right">Templates</th><th className="px-3 py-2.5 text-right">Receita</th><th className="px-3 py-2.5 text-right">Custo Meta</th><th className="px-3 py-2.5 text-right">Infra</th><th className="px-3 py-2.5 text-right">Margem</th><th className="px-5 py-2.5 text-right">%</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.tenantId}>
                  <td className="px-5 py-2.5 font-medium text-ink flex items-center gap-2"><Building2 size={14} className="text-faint" />{r.name}<span className={cn('text-[10px] rounded-full px-1.5', r.status === 'active' ? 'bg-ok-soft text-ok' : 'bg-field text-muted')}>{r.status ?? '—'}</span></td>
                  <td className="px-3 py-2.5 text-muted">{r.plan ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right tnum">{r.messagesSent.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2.5 text-right tnum">{r.templatesSent.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2.5 text-right tnum">{brl(r.revenue)}{r.overage > 0 && <span className="text-[10px] text-warn ml-1">+{brl(r.overage)}</span>}</td>
                  <td className="px-3 py-2.5 text-right tnum">{brl(r.providerCost)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{brl(r.infraCost)}</td>
                  <td className={cn('px-3 py-2.5 text-right tnum font-semibold', r.margin >= 0 ? 'text-ok' : 'text-danger')}>{brl(r.margin)}</td>
                  <td className={cn('px-5 py-2.5 text-right tnum', r.marginPct < 30 ? 'text-warn' : 'text-muted')}>{r.marginPct.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-faint flex items-center gap-1.5"><TrendingUp size={12} /> Custo de infra é o rateio configurado por número (`infraCostMonth`). Margem abaixo de 30% aparece em laranja.</p>
    </PageShell>
  );
}
