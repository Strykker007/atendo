'use client';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { ReportDefinition } from '@/lib/hooks';

const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
const MAX_SLICES = 6; // além disso vira "Outros" — cores categóricas nunca são cicladas

export const METRIC_LABEL: Record<ReportDefinition['metric'], string> = {
  conversations: 'Conversas',
  messages_in: 'Mensagens recebidas',
  messages_out: 'Mensagens enviadas',
  avg_first_response_min: 'Tempo médio da 1ª resposta (min)',
};
export const GROUP_LABEL: Record<ReportDefinition['groupBy'], string> = {
  day: 'Dia', week: 'Semana', month: 'Mês', tag: 'Tag', status: 'Status', number: 'Número', agent: 'Atendente', origin: 'Origem', campaign: 'Campanha (anúncio)',
};
const ENUM_LABEL: Record<string, string> = { waiting: 'Aguardando', in_progress: 'Em atendimento', closed: 'Encerrado', organic: 'Orgânico', ad: 'Anúncio', post: 'Publicação', link: 'Link' };

/** Séries de tempo: preenche dias/semanas/meses sem dado com 0 para a linha ser contínua. */
export function fillTime(def: ReportDefinition, series: { label: string; value: number }[]) {
  if (!['day', 'week', 'month'].includes(def.groupBy)) return series;
  const map = new Map(series.map((s) => [s.label, s.value]));
  const out: { label: string; value: number }[] = [];
  // from/to podem vir como 'YYYY-MM-DD' (builder) ou ISO completo (resposta da API)
  const d = new Date(String(def.from).slice(0, 10) + 'T00:00:00Z');
  const end = new Date(String(def.to).slice(0, 10) + 'T00:00:00Z');
  if (def.groupBy === 'week') { const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); } // segunda
  if (def.groupBy === 'month') d.setUTCDate(1);
  let guard = 0;
  while (d < end && guard++ < 2000) {
    const key = def.groupBy === 'month' ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10);
    out.push({ label: key, value: map.get(key) ?? 0 });
    if (def.groupBy === 'day') d.setUTCDate(d.getUTCDate() + 1);
    else if (def.groupBy === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

export const fmtLabel = (groupBy: ReportDefinition['groupBy'], l: string): string => {
  if (groupBy === 'status' || groupBy === 'origin') return ENUM_LABEL[l] ?? l;
  if (groupBy === 'day' || groupBy === 'week') { const [, m, d] = l.split('-'); return `${d}/${m}`; }
  if (groupBy === 'month') { const [y, m] = l.split('-'); return `${m}/${y}`; }
  return l;
};
const fmtValue = (metric: ReportDefinition['metric'], v: number) => (metric === 'avg_first_response_min' ? `${v.toFixed(1)} min` : v.toLocaleString('pt-BR'));

function TooltipBox({ active, payload, label, metric }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string; metric: ReportDefinition['metric'] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-panel border border-line shadow-lg px-3 py-2 text-xs">
      <div className="text-muted mb-0.5">{label ?? payload[0].name}</div>
      <div className="font-semibold text-ink tnum">{fmtValue(metric, payload[0].value)}</div>
    </div>
  );
}

/** Gráfico do relatório. Uma escala, marcas finas, grade discreta, tooltip por marca. */
export function ReportChart({ def, series, height = 320 }: { def: ReportDefinition; series: { label: string; value: number }[]; height?: number }) {
  const isTime = def.groupBy === 'day' || def.groupBy === 'week' || def.groupBy === 'month';
  let data = fillTime(def, series).map((s) => ({ name: fmtLabel(def.groupBy, s.label), value: s.value }));
  if (def.chart === 'pie' && data.length > MAX_SLICES) {
    const sorted = [...data].sort((a, b) => b.value - a.value);
    data = [...sorted.slice(0, MAX_SLICES - 1), { name: 'Outros', value: sorted.slice(MAX_SLICES - 1).reduce((a, b) => a + b.value, 0) }];
  }
  if (data.length === 0 || data.every((d) => d.value === 0)) return <div className="grid place-items-center text-sm text-muted" style={{ height }}>Sem dados no período.</div>;

  const axisTick = { fill: 'var(--muted)', fontSize: 11 };
  const margin = { top: 8, right: 12, left: 0, bottom: 4 };

  if (def.chart === 'pie') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={70} outerRadius={120} paddingAngle={2} stroke="var(--panel)" strokeWidth={2}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip content={<TooltipBox metric={def.metric} />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (def.chart === 'line') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={margin}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="name" tick={axisTick} axisLine={{ stroke: 'var(--line)' }} tickLine={false} minTickGap={24} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={44} allowDecimals={def.metric === 'avg_first_response_min'} />
          <Tooltip content={<TooltipBox metric={def.metric} />} cursor={{ stroke: 'var(--line-strong)' }} />
          <Line type="monotone" dataKey="value" stroke="var(--c1)" strokeWidth={2} dot={{ r: 3, fill: 'var(--c1)', stroke: 'var(--panel)', strokeWidth: 2 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  // rótulos de categoria são longos (tags, campanhas): barras horizontais a partir de 4 itens ou nome > 14 chars
  const horizontal = !isTime && (data.length > 4 || data.some((d) => d.name.length > 14));
  const short = (n: string) => (n.length > 28 ? n.slice(0, 27) + '…' : n);
  return (
    <ResponsiveContainer width="100%" height={Math.max(height, horizontal ? data.length * 34 + 40 : 0)}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={margin} barCategoryGap="28%">
        <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--grid)" />
        {/* Recharts só reconhece XAxis/YAxis como filhos diretos — nada de Fragment aqui */}
        {horizontal && <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} allowDecimals={def.metric === 'avg_first_response_min'} />}
        {horizontal && <YAxis type="category" dataKey="name" tick={axisTick} tickFormatter={short} axisLine={false} tickLine={false} width={170} />}
        {!horizontal && <XAxis dataKey="name" tick={axisTick} axisLine={{ stroke: 'var(--line)' }} tickLine={false} interval={0} angle={data.length > 8 ? -30 : 0} textAnchor={data.length > 8 ? 'end' : 'middle'} height={data.length > 8 ? 56 : 30} />}
        {!horizontal && <YAxis tick={axisTick} axisLine={false} tickLine={false} width={44} allowDecimals={def.metric === 'avg_first_response_min'} />}
        <Tooltip content={<TooltipBox metric={def.metric} />} cursor={{ fill: 'var(--field)' }} />
        <Bar dataKey="value" fill="var(--c1)" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={40}>
          {!isTime && data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
