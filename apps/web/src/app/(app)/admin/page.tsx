'use client';
import { useState } from 'react';
import Link from 'next/link';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Building2, Wallet, TrendingUp, AlertTriangle, Users, Receipt, Download, Hourglass } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { SkeletonCards, SkeletonRows } from '@/components/ui/Skeleton';
import { useFinance, useMargin, useMe, type DiscountGrant, type DiscountSource } from '@/lib/hooks';
import { Button } from '@/components/ui/Button';
import { useBrand } from '@/lib/brand-context';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brlK = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0));
const periodOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const mm = (p: string) => { const [y, m] = p.split('-'); return `${m}/${y.slice(2)}`; };
const STATUS_PT: Record<string, string> = { trialing: 'Teste', active: 'Ativa', past_due: 'Pendente', suspended: 'Suspensa', canceled: 'Cancelada', draft: 'Rascunho', open: 'Em aberto', paid: 'Paga', failed: 'Falhou', void: 'Cancelada' };
const axis = { fill: 'var(--muted)', fontSize: 11 };
const Tip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number | string; color?: string }[]; label?: string }) => active && payload?.length ? (
  <div className="rounded-lg bg-panel border border-line shadow-lg px-3 py-2 text-xs space-y-0.5">
    <div className="text-muted">{label}</div>
    {payload.map((p) => <div key={p.name} className="flex justify-between gap-4"><span style={{ color: p.color }}>{p.name}</span><b className="text-ink tnum">{typeof p.value === 'number' && p.name !== 'Clientes' ? brl(p.value) : p.value}</b></div>)}
  </div>
) : null;

type Tab = 'visao' | 'teste' | 'faturas' | 'descontos' | 'margem';

const ORIGEM: Record<DiscountSource, string> = { checkout: 'Checkout', tenant_create: 'Novo cliente', manual: 'Dono, no cliente', bulk: 'Dono, aplicar a todos', plan_return: 'Voltou ao plano' };
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
/** Fim efetivo: o que vier primeiro entre o previsto e o encerramento. */
const fimDe = (g: DiscountGrant) => (g.endsAt && g.closedAt ? (g.endsAt < g.closedAt ? g.endsAt : g.closedAt) : g.closedAt ?? g.endsAt);

const num = (v: number) => v.toFixed(2).replace('.', ',');

/** CSV para a contabilidade/planilha (`;` e vírgula decimal: abre direto no Excel em pt-BR). */
function baixarCsv(nome: string, head: string[], linhas: string[][]) {
  const cel = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const blob = new Blob(['\ufeff' + [head, ...linhas].map((l) => l.map(cel).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${nome}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportarDescontos(rows: DiscountGrant[]) {
  baixarCsv('descontos', ['Concedido em', 'Cliente', 'Plano', 'Tipo', 'Promoção', 'Origem', 'Concedido por', 'Preço de tabela', 'Valor concedido', 'Desconto %', 'Unidades', 'Desconto/mês', 'Início', 'Fim previsto', 'Encerrado em'], rows.map((g) => [
    dia(g.createdAt), g.tenant, g.plan, g.kind === 'promotion' ? 'Promoção' : 'Negociado', g.promotion ?? '', ORIGEM[g.source], g.grantedBy ?? 'Automático',
    num(g.listPrice), num(g.priceMonth), num(g.discountPercent), String(g.units), num((g.listPrice - g.priceMonth) * g.units), dia(g.startsAt), dia(g.endsAt), dia(g.closedAt),
  ]));
}

/** Nome do cliente com atalho para ele em Clientes (onde se age: plano, status, vencimento). */
const Cliente = ({ nome }: { nome: string }) => <Link href={`/clientes?busca=${encodeURIComponent(nome)}`} className="text-ink hover:text-accent-ink hover:underline">{nome}</Link>;

/** Situação do teste em texto: "termina em 5 dias", "termina hoje", "venceu há 3 dias". */
const prazoTeste = (dias: number) => (dias > 1 ? `termina em ${dias} dias` : dias === 1 ? 'termina amanhã' : dias === 0 ? 'termina hoje' : `venceu há ${-dias} dia${dias === -1 ? '' : 's'}`);

/** Linha de ações acima de uma tabela: explicação curta + exportar. */
function Exportar({ texto, onClick, disabled }: { texto: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p className="text-[12px] text-muted">{texto}</p>
      <Button size="sm" variant="ghost" icon={<Download size={14} />} disabled={disabled} onClick={onClick}>Exportar CSV</Button>
    </div>
  );
}

/** Financeiro do dono do Atendo. Só super_admin (a API também bloqueia). */
export default function AdminPage() {
  const { brandName } = useBrand();
  const me = useMe();
  const [tab, setTab] = useState<Tab>('visao');
  const [months, setMonths] = useState(12);
  const [period, setPeriod] = useState(periodOf(new Date()));
  const fin = useFinance(months);
  const margin = useMargin(period);
  if (me.data && !me.data.systemOwner) return <PageShell><p className="text-sm text-muted">Área restrita ao dono do sistema.</p></PageShell>;

  const d = fin.data;
  const series = d?.series.map((s) => ({ ...s, mes: mm(s.period), Faturado: s.invoiced, Recebido: s.received, Atrasado: s.overdue, Custo: s.providerCost + s.infraCost, Excedente: s.overage, Clientes: s.newTenants })) ?? [];

  return (
    <PageShell width="max-w-6xl">
      <PageHeader title="Financeiro" subtitle={`Receita, custos e margem do ${brandName} como um todo. Dados vêm das assinaturas, faturas do Stripe e do ledger de uso.`} action={
        <div className="flex items-center gap-1 rounded-lg bg-field p-0.5 text-sm">
          {([['visao', 'Visão geral'], ['teste', 'Em teste'], ['faturas', 'Faturas'], ['descontos', 'Descontos'], ['margem', 'Margem por cliente']] as [Tab, string][]).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} className={cn('px-3 py-1.5 rounded-md font-medium', tab === t ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink')}>{l}</button>
          ))}
        </div>
      } />

      {fin.isLoading && <SkeletonCards count={4} />}

      {d && tab === 'visao' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={<Wallet size={16} />} label="MRR (receita recorrente/mês)" value={brl(d.now.mrr)} sub={`ARR ${brl(d.now.arr)}${d.now.discountMonth ? ` · ${brl(d.now.discountMonth)} em descontos` : ''}`} />
            <Kpi icon={<Users size={16} />} label="Clientes ativos" value={String(d.now.activeTenants)} sub={`${d.now.trialing} em teste (${brl(d.now.trialMrr)}/mês a converter) · ${d.now.canceled} cancelados`} />
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
                  <li key={p.plan} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink">{p.plan} <span className="text-muted">· {p.count}{p.trialing > 0 && ` (${p.trialing} em teste, fora do MRR)`}</span></span>
                    <span className="text-right">
                      <b className="tnum block">{brl(p.mrr)}</b>
                      {/* margem só aparece com custo cadastrado: "margem = receita" seria mentira
                          confortável, e é o tipo de número que vira decisão de preço */}
                      {p.cost > 0 && <span className={cn('text-[11px] tnum', p.margin >= 0 ? 'text-ok' : 'text-danger')}>margem {brl(p.margin)}</span>}
                    </span>
                  </li>
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

      {d && tab === 'teste' && (
        <>
          <div className="grid gap-4 sm:grid-cols-3 mb-4">
            <Kpi icon={<Hourglass size={16} />} label="Receita em teste/mês" value={brl(d.now.trialMrr)} sub={`${d.trials.length} cliente(s) em teste, fora do MRR`} tone={d.now.trialMrr > 0 ? 'warn' : undefined} />
            <Kpi icon={<Hourglass size={16} />} label="Terminam em 7 dias" value={String(d.now.trialsEndingSoon)} sub={brl(d.trials.filter((t) => t.daysLeft <= 7).reduce((a, t) => a + t.price, 0)) + '/mês em jogo'} />
            <Kpi icon={<Hourglass size={16} />} label="Tempo médio em teste" value={`${d.trials.length ? Math.round(d.trials.reduce((a, t) => a + t.daysIn, 0) / d.trials.length) : 0} dias`} sub={`${d.trials.filter((t) => t.daysLeft < 0).length} com teste vencido`} />
          </div>
          <Exportar texto="Clientes em teste sem pagamento, pelo fim do teste. Mensalidade = o que passa a entrar quando ele converter." disabled={!d.trials.length} onClick={() => baixarCsv('em-teste', ['Cliente', 'Plano', 'Mensalidade', 'Início', 'Dias em teste', 'Fim do teste', 'Situação'], d.trials.map((t) => [
            t.tenant, t.plan, num(t.price), dia(t.startedAt), String(t.daysIn), dia(t.endsAt), prazoTeste(t.daysLeft),
          ]))} />
          <Table head={['Cliente', 'Plano', 'Mensalidade', 'Em teste há', 'Fim do teste', 'Situação']} rows={d.trials.map((t) => [
            <Cliente key="c" nome={t.tenant} />, t.plan, brl(t.price), `${t.daysIn} dia${t.daysIn === 1 ? '' : 's'}`, dia(t.endsAt),
            <span key="p" className={t.daysLeft < 0 ? 'text-danger' : t.daysLeft <= 7 ? 'text-warn' : 'text-muted'}>{prazoTeste(t.daysLeft)}</span>,
          ])} empty="Nenhum cliente em teste." />
        </>
      )}

      {d && tab === 'faturas' && (
        <>
          <Exportar texto="Faturas dos últimos meses (até 100), mais recente primeiro." disabled={!d.invoices.length} onClick={() => baixarCsv('faturas', ['Cliente', 'Período', 'Total', 'Excedente', 'Status', 'Vencimento', 'Pago em'], d.invoices.map((i) => [
            i.tenant, i.period, num(i.total), num(i.overage), STATUS_PT[i.status] ?? i.status, dia(i.dueAt), dia(i.paidAt),
          ]))} />
          <Table head={['Cliente', 'Período', 'Total', 'Excedente', 'Status', 'Vencimento', '']} rows={d.invoices.map((i) => [
          <Cliente key="c" nome={i.tenant} />, i.period, brl(i.total), brl(i.overage), <Pill key="s" status={i.status} />, i.dueAt ? new Date(i.dueAt).toLocaleDateString('pt-BR') : '—',
          i.hostedUrl ? <a key="l" href={i.hostedUrl} target="_blank" rel="noreferrer" className="text-accent-ink underline text-xs">Stripe</a> : '',
        ])} empty="Nenhuma fatura ainda — aparecem quando o Stripe gerar a primeira cobrança." />
        </>
      )}

      {d && tab === 'descontos' && (
        <>
          <div className="grid gap-4 sm:grid-cols-3 mb-4">
            <Kpi icon={<Receipt size={16} />} label="Desconto vigente/mês" value={brl(d.now.discountMonth)} sub={`${d.now.discountedTenants} cliente(s) com desconto hoje`} tone={d.now.discountMonth > 0 ? 'warn' : undefined} />
            <Kpi icon={<Receipt size={16} />} label="Desconto este mês" value={brl(d.series[d.series.length - 1]?.discounts ?? 0)} sub="pelo livro de descontos" />
            <Kpi icon={<Receipt size={16} />} label={`Desconto em ${months} meses`} value={brl(d.series.reduce((a, x) => a + x.discounts, 0))} sub={`${d.discounts.length} concessão(ões) registradas`} />
          </div>
          <Exportar texto="Toda concessão de valor diferente do de tabela, permanente. Encerrada antes do previsto mostra a data." disabled={!d.discounts.length} onClick={() => exportarDescontos(d.discounts)} />
          <Table head={['Concedido em', 'Cliente', 'Plano', 'Tipo', 'De → por', '%', 'Vigência', 'Origem / por']} rows={d.discounts.map((g) => {
            const fim = fimDe(g);
            const correndo = !fim || new Date(fim) > new Date();
            return [
              dia(g.createdAt), <Cliente key="c" nome={g.tenant} />, g.plan,
              g.kind === 'promotion' ? <span key="k" className="text-accent-ink">{g.promotion ?? 'Promoção'}</span> : 'Negociado',
              <span key="v">{brl(g.listPrice)} → <b className="text-ink">{brl(g.priceMonth)}</b>{g.units > 1 && <span className="text-faint"> × {g.units}</span>}</span>,
              `${g.discountPercent.toLocaleString('pt-BR')}%`,
              <span key="p" className={correndo ? 'text-ok' : 'text-muted'}>{dia(g.startsAt)} – {fim ? dia(fim) : 'sem data'}{g.closedAt && (!g.endsAt || g.closedAt < g.endsAt) ? ' (encerrado)' : ''}</span>,
              <span key="o" className="text-muted">{ORIGEM[g.source]}{g.grantedBy ? ` · ${g.grantedBy}` : ''}</span>,
            ];
          })} empty="Nenhum desconto concedido ainda." />
        </>
      )}

      {tab === 'margem' && (
        <>
          <div className="flex justify-end"><select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-line bg-panel text-ink px-3 py-1.5 text-sm">{Array.from({ length: 6 }, (_, i) => { const x = new Date(); x.setMonth(x.getMonth() - i); return periodOf(x); }).map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
          {margin.isLoading && <SkeletonRows rows={4} />}
          {margin.data && (
            <>
            <Exportar texto={`Receita, custo e margem de cada cliente em ${mm(period)}.`} disabled={!margin.data.length} onClick={() => baixarCsv(`margem-${period}`, ['Cliente', 'Plano', 'Mensagens', 'Templates', 'Receita', 'Excedente', 'Custo Meta', 'Infra', 'Margem', 'Margem %'], margin.data!.map((r) => [
              r.name, r.plan ?? '', String(r.messagesSent), String(r.templatesSent), num(r.revenue), num(r.overage), num(r.providerCost), num(r.infraCost), num(r.margin), num(r.marginPct),
            ]))} />
            <Table head={['Cliente', 'Plano', 'Msgs', 'Templates', 'Receita', 'Custo Meta', 'Infra', 'Margem', '%']} rows={margin.data.map((r) => [
              <span key="n" className="inline-flex items-center gap-2"><Building2 size={14} className="text-faint" /><Cliente nome={r.name} /></span>, r.plan ?? '—', r.messagesSent.toLocaleString('pt-BR'), r.templatesSent.toLocaleString('pt-BR'),
              <span key="r">{brl(r.revenue)}{r.overage > 0 && <span className="text-[10px] text-warn ml-1">+{brl(r.overage)}</span>}</span>, brl(r.providerCost), brl(r.infraCost),
              <b key="m" className={r.margin >= 0 ? 'text-ok' : 'text-danger'}>{brl(r.margin)}</b>, <span key="p" className={r.marginPct < 30 ? 'text-warn' : 'text-muted'}>{r.marginPct.toFixed(0)}%</span>,
            ])} />
            </>
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
