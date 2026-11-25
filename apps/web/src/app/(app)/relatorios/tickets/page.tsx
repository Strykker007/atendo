'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Ticket } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell, Empty } from '@/components/ui/Page';
import { Field, inputCls } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { FeatureLocked } from '@/components/billing/FeatureLocked';
import { useCan, useHasFeature, useTicketOptions, useTicketReport, type TicketReportRow } from '@/lib/hooks';

// mesmas regras de data das outras telas de relatório: fuso do navegador, fim exclusivo
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = (dia: string, n: number) => { const d = new Date(`${dia}T00:00:00`); d.setDate(d.getDate() + n); return iso(d); };
const inicioDoDia = (dia: string) => new Date(`${dia}T00:00:00`).toISOString();
const hoje = () => iso(new Date());
const PRESETS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: '7d', label: 'Últimos 7 dias', range: () => [shift(hoje(), -6), shift(hoje(), 1)] },
  { key: '30d', label: 'Últimos 30 dias', range: () => [shift(hoje(), -29), shift(hoje(), 1)] },
  { key: 'mes', label: 'Mês atual', range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(new Date(n.getFullYear(), n.getMonth() + 1, 1))]; } },
  { key: '90d', label: 'Últimos 90 dias', range: () => [shift(hoje(), -89), shift(hoje(), 1)] },
];

/** minutos → "45min", "3h 20min", "2d 5h" */
function fmtDur(m: number | null) {
  if (m == null) return '—';
  if (m < 60) return `${m}min`;
  if (m < 1440) { const h = Math.floor(m / 60); const r = m % 60; return r ? `${h}h ${r}min` : `${h}h`; }
  const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}
const fmtPct = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const fmtDia = (ymd: string) => { const [, m, d] = ymd.split('-'); return `${d}/${m}`; };

const QUEBRAS = [
  ['byPerson', 'Responsável'],
  ['byDepartment', 'Setor'],
  ['byType', 'Tipo'],
  ['byPriority', 'Prioridade'],
  ['bySource', 'Origem'],
] as const;
type Quebra = (typeof QUEBRAS)[number][0];

/**
 * Relatório de tickets (docs/tickets.md#relatório): volume, tempos (mediana = o típico, que um
 * ticket esquecido não distorce), prazo e espera, com quebra por responsável/setor/tipo/prioridade/origem.
 */
export default function TicketsReportPage() {
  // os três sempre chamados (hook não pode ser condicional)
  const verRelatorios = useCan('reports.view');
  const verTodos = useCan('tickets.view_all');
  const gestao = useCan('tickets.manage');
  const podeVer = verRelatorios || verTodos || gestao;
  const feature = useHasFeature('tickets');
  const opts = useTicketOptions(feature.has);
  const [preset, setPreset] = useState('30d');
  const [range, setRange] = useState<[string, string]>(PRESETS[1].range());
  const [departmentId, setDepartmentId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [quebra, setQuebra] = useState<Quebra>('byPerson');
  const q = useTicketReport({ startDate: inicioDoDia(range[0]), endDate: inicioDoDia(range[1]), departmentId: departmentId || undefined, typeId: typeId || undefined });
  const d = q.data;

  if (!podeVer) return <PageShell><p className="text-sm text-muted">Seu perfil de acesso não inclui relatórios de tickets.</p></PageShell>;
  if (!feature.loading && !feature.has) return <FeatureLocked title="Tickets internos" text="Pedidos entre setores com prazo, espera e relatório de desempenho." />;
  const chip = (on: boolean) => cn('text-xs font-semibold px-2.5 py-1.5 rounded-lg border', on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field');

  return (
    <PageShell width="max-w-6xl">
      <PageHeader
        title="Relatório de tickets"
        subtitle="Quanto entra, quanto sai, em quanto tempo e quanto fica dentro do prazo."
        action={
          <div className="flex items-center gap-3">
            <Link href="/tickets" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><Ticket size={15} /> Tickets</Link>
            <Link href="/relatorios" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Relatórios</Link>
          </div>
        }
      />

      <section className="rounded-2xl bg-panel border border-line p-3 space-y-3 mb-4">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => <button key={p.key} type="button" onClick={() => { setPreset(p.key); setRange(p.range()); }} className={chip(preset === p.key)}>{p.label}</button>)}
          <button type="button" onClick={() => setPreset('custom')} className={chip(preset === 'custom')}>Personalizado</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {preset === 'custom' && (
            <>
              <Field label="Data inicial"><input type="date" className={inputCls} value={range[0]} max={shift(range[1], -1)} onChange={(e) => e.target.value && setRange([e.target.value, range[1]])} /></Field>
              <Field label="Data final"><input type="date" className={inputCls} value={shift(range[1], -1)} min={range[0]} onChange={(e) => e.target.value && setRange([range[0], shift(e.target.value, 1)])} /></Field>
            </>
          )}
          <Field label="Setor">
            <select className={inputCls} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">Todos</option>
              {opts.data?.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              <option value="none">Sem setor</option>
            </select>
          </Field>
          <Field label="Tipo">
            <select className={inputCls} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Todos</option>
              {opts.data?.types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        </div>
      </section>

      {q.isLoading && <SkeletonCards count={6} />}
      {q.error && <p className="text-sm text-danger-ink">{(q.error as Error).message}</p>}
      {d && (
        <div className="space-y-4">
          {/* números do período + retrato de agora */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Tile label="Abertos no período" value={String(d.totals.created)} sub={`${d.totals.resolved} resolvidos · ${d.totals.canceled} cancelados`} />
            <Tile label="Pendentes agora" value={String(d.totals.active)} sub={`${d.totals.overdue} atrasados · ${d.totals.toPick} sem responsável · ${d.totals.onHold} em espera`} alerta={d.totals.overdue > 0} />
            <Tile label="1ª resposta (típica)" value={fmtDur(d.totals.medianFirstResponseMin)} sub={`média ${fmtDur(d.totals.avgFirstResponseMin)}`} help="Da abertura até a primeira ação de alguém da equipe que não é quem abriu (comentário, assumir, transferir, mudar situação)." />
            <Tile label="Resolução (típica)" value={fmtDur(d.totals.medianResolutionMin)} sub={`sem a espera: ${fmtDur(d.totals.medianNetResolutionMin)}`} help="Da abertura até resolver. 'Sem a espera' desconta o tempo parado em espera (peça, prestador…), que não dependia da equipe." />
            <Tile label="Resolvidos no prazo" value={fmtPct(d.totals.onTimePct)} sub={d.totals.resolvedWithDue ? `de ${d.totals.resolvedWithDue} com prazo` : 'nenhum resolvido tinha prazo'} />
          </div>

          <section className="rounded-2xl bg-panel border border-line p-4">
            <h2 className="font-display font-semibold text-ink mb-3">Abertos × resolvidos por dia</h2>
            {d.series.every((s) => !s.created && !s.resolved)
              ? <p className="text-sm text-faint py-10 text-center">Nenhum ticket aberto ou resolvido no período.</p>
              : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={d.series.map((s) => ({ ...s, label: fmtDia(s.day) }))} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                      <CartesianGrid vertical={false} stroke="var(--grid)" />
                      <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--line)' }} tickLine={false} minTickGap={24} />
                      <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12, color: 'var(--ink)' }} cursor={{ stroke: 'var(--line-strong)' }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
                      <Line type="monotone" name="Abertos" dataKey="created" stroke="var(--c1)" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: 'var(--panel)', strokeWidth: 2 }} />
                      <Line type="monotone" name="Resolvidos" dataKey="resolved" stroke="var(--c2)" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: 'var(--panel)', strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
          </section>

          <section className="rounded-2xl bg-panel border border-line">
            <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
              <h2 className="font-display font-semibold text-ink mr-2">Por</h2>
              {QUEBRAS.map(([k, l]) => <button key={k} type="button" onClick={() => setQuebra(k)} className={chip(quebra === k)}>{l}</button>)}
            </div>
            <Tabela rows={d[quebra]} />
          </section>

          <section className="rounded-2xl bg-panel border border-line">
            <h2 className="font-display font-semibold text-ink px-4 pt-4">Tempo em espera por motivo</h2>
            <p className="px-4 text-[12.5px] text-muted">Esperas que começaram no período. Mostra o que mais segura os tickets fora da equipe.</p>
            {!d.holdByReason.length ? <p className="px-4 py-6 text-sm text-faint">Nenhum ticket entrou em espera no período.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm mt-2">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-faint border-b border-line"><th className="px-4 py-2 font-medium">Motivo</th><th className="px-3 py-2 font-medium text-right">Vezes</th><th className="px-3 py-2 font-medium text-right">Tempo total</th><th className="px-4 py-2 font-medium text-right">Média por espera</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {d.holdByReason.map((h) => <tr key={h.reason}><td className="px-4 py-2 text-ink">{h.reason}</td><td className="px-3 py-2 text-right tnum">{h.count}</td><td className="px-3 py-2 text-right tnum">{fmtDur(h.totalMin)}</td><td className="px-4 py-2 text-right tnum">{fmtDur(h.avgMin)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}

function Tile({ label, value, sub, help, alerta }: { label: string; value: string; sub?: string; help?: string; alerta?: boolean }) {
  return (
    <div className="rounded-2xl bg-panel border border-line p-4" title={help}>
      <p className="text-[12px] text-muted">{label}</p>
      <p className={cn('font-display text-2xl font-semibold tnum mt-1', alerta ? 'text-danger-ink' : 'text-ink')}>{value}</p>
      {sub && <p className="text-[11.5px] text-faint mt-1">{sub}</p>}
    </div>
  );
}

function Tabela({ rows }: { rows: TicketReportRow[] }) {
  if (!rows.length) return <Empty icon={<Ticket size={24} />} title="Sem tickets" text="Nada aberto, resolvido ou pendente com esses filtros." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm mt-3">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-faint border-b border-line">
            <th className="px-4 py-2 font-medium">Nome</th>
            <th className="px-3 py-2 font-medium text-right">Abertos</th>
            <th className="px-3 py-2 font-medium text-right">Resolvidos</th>
            <th className="px-3 py-2 font-medium text-right">Pendentes</th>
            <th className="px-3 py-2 font-medium text-right">Atrasados</th>
            <th className="px-3 py-2 font-medium text-right" title="Mediana">1ª resposta</th>
            <th className="px-3 py-2 font-medium text-right" title="Mediana">Resolução</th>
            <th className="px-4 py-2 font-medium text-right">No prazo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="px-4 py-2 text-ink">{r.name}</td>
              <td className="px-3 py-2 text-right tnum">{r.created}</td>
              <td className="px-3 py-2 text-right tnum">{r.resolved}</td>
              <td className="px-3 py-2 text-right tnum">{r.active}</td>
              <td className={cn('px-3 py-2 text-right tnum', r.overdue > 0 && 'text-danger-ink font-semibold')}>{r.overdue}</td>
              <td className="px-3 py-2 text-right tnum">{fmtDur(r.medianFirstResponseMin)}</td>
              <td className="px-3 py-2 text-right tnum">{fmtDur(r.medianResolutionMin)}</td>
              <td className="px-4 py-2 text-right tnum">{fmtPct(r.onTimePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
