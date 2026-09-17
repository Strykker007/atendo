'use client';
import { useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Building2, Wallet, TrendingUp, AlertTriangle, Users, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { SkeletonCards, SkeletonRows } from '@/components/ui/Skeleton';
import { useFinance, useMargin, useMe } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brlK = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0));
const periodOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const mm = (p: string) => { const [y, m] = p.split('-'); return `${m}/${y.slice(2)}`; };
const STATUS_PT: Record<string, string> = { trialing: 'Teste', active: 'Ativa', past_due: 'Pendente', suspended: 'Suspensa', canceled: 'Cancelada', draft: 'Rascunho', open: 'Em aberto', paid: 'Paga', failed: 'Falhou', void: 'Cancelada' };
const axis = { fill: 'var(--muted)', fontSize: 11 };
const Tip = ({ active, payload, label }: any) => active && payload?.length ? (
  <div className="rounded-lg bg-panel border border-line shadow-lg px-3 py-2 text-xs space-y-0.5">
    <div className="text-muted">{label}</div>
    {payload.map((p: any) => <div key={p.name} className="flex justify-between gap-4"><span style={{ color: p.color }}>{p.name}</span><b className="text-ink tnum">{typeof p.value === 'number' && p.name !== 'Clientes' ? brl(p.value) : p.value}</b></div>)}
  </div>
) : null;

type Tab = 'visao' | 'clientes' | 'faturas' | 'margem';

/** Financeiro do dono do Atendo. Só super_admin (a API também bloqueia). */
export default function AdminPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>('visao');
  const [months, setMonths] = useState(12);
  const [period, setPeriod] = useState(periodOf(new Date()));
  const fin = useFinance(months);
  const margin = useMargin(period);
  if (me.data && me.data.role !== 'super_admin') return <PageShell><p className="text-sm text-muted">Área restrita ao dono do sistema.</p></PageShell>;

  const d = fin.data;
  const series = d?.series.map((s) => ({ ...s, mes: mm(s.period), Faturado: s.invoiced, Recebido: s.received, Atrasado: s.overdue, Custo: s.providerCost + s.infraCost, Excedente: s.overage, Clientes: s.newTenants })) ?? [];

  return (
    <PageShell width="max-w-6xl">
      <PageHeader title="Financeiro" subtitle="Receita, custos e margem do Atendo como um todo. Dados vêm das assinaturas, faturas do Stripe e do ledger de uso." action={
        <div className="flex items-center gap-1 rounded-lg bg-field p-0.5 text-sm">
          {([['visao', 'Visão geral'], ['clientes', 'Assinaturas'], ['faturas', 'Faturas'], ['margem', 'Margem por cliente']] as [Tab, string][]).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} className={cn('px-3 py-1.5 rounded-md font-medium', tab === t ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink')}>{l}</button>
          ))}
        </div>
      } />

      {fin.isLoading && <SkeletonCards count={4} />}

      {d && tab === 'visao' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={<Wallet size={16} />} label="MRR (receita recorrente/mês)" value={brl(d.now.mrr)} sub={`ARR ${brl(d.now.arr)}`} />
            <Kpi icon={<Users size={16} />} label="Clientes ativos" value={String(d.now.activeTenants)} sub={`${d.now.trialing} em teste · ${d.now.canceled} cancelados`} />
            <Kpi icon={<AlertTriangle size={16} />} label="Em atraso" value={brl(d.now.overdueAmount)} sub={`${d.now.pastDue} pendentes · ${d.now.suspended} suspensos`} tone={d.now.overdueAmount > 0 ? 'warn' : undefined} />
            <Kpi icon={<TrendingUp size={16} />} label="Margem estimada do mês" value={brl(d.now.monthMargin)} sub={`custo ${brl(d.now.monthCost)}`} tone={d.now.monthMargin < 0 ? 'danger' : 'ok'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <section className="rounded-2xl bg-panel border border-line p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-display font-semibold text-ink text-sm">Faturado × Recebido × Custo</h3>
                <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="rounded-md border border-line bg-panel text-ink text-xs px-2 py-1">{[6, 12, 24].map((m) => <option key={m} value={m}>{m} meses</option>)}</select>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="mes" tick={axis} axisLine={{ stroke: 'var(--line)' }} tickLine={false} />
                  <YAxis tick={axis} axisLine={false} tickLine={false} width={44} tickFormatter={brlK} />
                  <Tooltip content={<Tip />} cursor={{ fill: 'var(--field)' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }} />
                  <Bar dataKey="Faturado" fill="var(--c1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="Recebido" fill="var(--c3)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="Custo" fill="var(--c2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </section>
            <section className="rounded-2xl bg-panel border border-line p-4">
              <h3 className="font-display font-semibold text-ink text-sm mb-2">MRR por plano</h3>
              <ul className="divide-y divide-line">
                {d.byPlan.map((p) => (
                  <li key={p.plan} className="flex items-center justify-between py-2 text-sm"><span className="text-ink">{p.plan} <span className="text-muted">· {p.count}</span></span><b className="tnum">{brl(p.mrr)}</b></li>
                ))}
                {d.byPlan.length === 0 && <li className="py-2 text-sm text-muted">Nenhuma assinatura ativa.</li>}
              </ul>
              <h3 className="font-display font-semibold text-ink text-sm mt-4 mb-2">Novos clientes / mês</h3>
              <ResponsiveContainer width="100%" height={110}>
                <LineChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="mes" tick={axis} axisLine={false} tickLine={false} minTickGap={20} />
                  <YAxis hide allowDecimals={false} />
                  <Tooltip content={<Tip />} />
                  <Line type="monotone" dataKey="Clientes" stroke="var(--c4)" strokeWidth={2} dot={{ r: 2.5 }} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          </div>
        </>
      )}

      {d && tab === 'clientes' && (
        <Table head={['Cliente', 'Plano', 'Mensalidade', 'Status', 'Renova em', 'Obs.']} rows={d.subscriptions.map((s) => [
          s.tenant, s.plan, brl(s.price), <Pill key="s" status={s.status} />, new Date(s.periodEnd).toLocaleDateString('pt-BR'),
          s.cancelAtPeriodEnd ? 'cancela no fim do período' : s.graceUntil ? `carência até ${new Date(s.graceUntil).toLocaleDateString('pt-BR')}` : '',
        ])} />
      )}

      {d && tab === 'faturas' && (
        <Table head={['Cliente', 'Período', 'Total', 'Excedente', 'Status', 'Vencimento', '']} rows={d.invoices.map((i) => [
          i.tenant, i.period, brl(i.total), brl(i.overage), <Pill key="s" status={i.status} />, i.dueAt ? new Date(i.dueAt).toLocaleDateString('pt-BR') : '—',
          i.hostedUrl ? <a key="l" href={i.hostedUrl} target="_blank" rel="noreferrer" className="text-accent-ink underline text-xs">Stripe</a> : '',
        ])} empty="Nenhuma fatura ainda — aparecem quando o Stripe gerar a primeira cobrança." />
      )}

      {tab === 'margem' && (
        <>
          <div className="flex justify-end"><select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-line bg-panel text-ink px-3 py-1.5 text-sm">{Array.from({ length: 6 }, (_, i) => { const x = new Date(); x.setMonth(x.getMonth() - i); return periodOf(x); }).map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
          {margin.isLoading && <SkeletonRows rows={4} />}
          {margin.data && (
            <Table head={['Cliente', 'Plano', 'Msgs', 'Templates', 'Receita', 'Custo Meta', 'Infra', 'Margem', '%']} rows={margin.data.map((r) => [
              <span key="n" className="inline-flex items-center gap-2"><Building2 size={14} className="text-faint" />{r.name}</span>, r.plan ?? '—', r.messagesSent.toLocaleString('pt-BR'), r.templatesSent.toLocaleString('pt-BR'),
              <span key="r">{brl(r.revenue)}{r.overage > 0 && <span className="text-[10px] text-warn ml-1">+{brl(r.overage)}</span>}</span>, brl(r.providerCost), brl(r.infraCost),
              <b key="m" className={r.margin >= 0 ? 'text-ok' : 'text-danger'}>{brl(r.margin)}</b>, <span key="p" className={r.marginPct < 30 ? 'text-warn' : 'text-muted'}>{r.marginPct.toFixed(0)}%</span>,
            ])} />
          )}
        </>
      )}
    </PageShell>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <div className="rounded-2xl bg-panel border border-line p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted">{icon}{label}</div>
      <div className={cn('text-2xl font-semibold tnum mt-1', tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</div>
      {sub && <div className="text-xs text-faint mt-0.5">{sub}</div>}
    </div>
  );
}
function Pill({ status }: { status: string }) {
  const cls = ['active', 'paid'].includes(status) ? 'bg-ok-soft text-ok' : ['past_due', 'open', 'trialing'].includes(status) ? 'bg-warn-soft text-warn-ink' : ['suspended', 'failed'].includes(status) ? 'bg-danger-soft text-danger-ink' : 'bg-field text-muted';
  return <span className={cn('text-xs rounded-full px-2 py-0.5', cls)}>{STATUS_PT[status] ?? status}</span>;
}
function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  return (
    <div className="rounded-2xl bg-panel border border-line overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-field text-left text-xs text-muted uppercase tracking-wide"><tr>{head.map((h, i) => <th key={i} className="px-4 py-2.5 whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 && <tr><td colSpan={head.length} className="px-4 py-6 text-center text-muted">{empty ?? 'Nada aqui.'}</td></tr>}
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="px-4 py-2.5 tnum whitespace-nowrap">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
