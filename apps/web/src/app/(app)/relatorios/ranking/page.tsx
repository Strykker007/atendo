'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowDown, ArrowUp, Crown, Medal, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Field, inputCls } from '@/components/ui/Modal';
import { TagPicker } from '@/components/chat/TagPicker';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { useCan, useConsultantRanking, useOutcomeLabels, useTags, type ConsultantRankingRow } from '@/lib/hooks';

// mesmas regras de data da tela de Relatórios: fuso do navegador, fim exclusivo
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = (dia: string, n: number) => { const d = new Date(`${dia}T00:00:00`); d.setDate(d.getDate() + n); return iso(d); };
const inicioDoDia = (dia: string) => new Date(`${dia}T00:00:00`).toISOString();
const hoje = () => iso(new Date());
const PRESETS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: 'hoje', label: 'Hoje', range: () => [hoje(), shift(hoje(), 1)] },
  { key: '7d', label: 'Últimos 7 dias', range: () => [shift(hoje(), -6), shift(hoje(), 1)] },
  { key: 'mes', label: 'Mês atual', range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(new Date(n.getFullYear(), n.getMonth() + 1, 1))]; } },
];

type SortKey = 'name' | 'closed' | 'won' | 'conversionRate' | 'avgHandleMin';
const fmtMin = (m: number | null) => (m == null ? '—' : m < 60 ? `${m.toFixed(0)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`);
const fmtPct = (v: number) => `${v.toFixed(v % 1 ? 1 : 0)}%`;

export default function RankingPage() {
  const podeVer = useCan('reports.view');
  const labels = useOutcomeLabels();
  const tags = useTags();
  const [preset, setPreset] = useState('mes');
  const [range, setRange] = useState<[string, string]>(PRESETS[2].range());
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'won', desc: true });
  const q = useConsultantRanking({ from: inicioDoDia(range[0]), to: inicioDoDia(range[1]), tagIds });

  const rows = useMemo(() => {
    const list = [...(q.data?.ranking ?? [])];
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      if (sort.key === 'name') return dir * a.name.localeCompare(b.name, 'pt-BR');
      // sem TMA vai sempre para o fim
      const va = a[sort.key] ?? (sort.desc ? -Infinity : Infinity);
      const vb = b[sort.key] ?? (sort.desc ? -Infinity : Infinity);
      return dir * ((va as number) - (vb as number)) || a.position - b.position;
    });
  }, [q.data, sort]);

  if (!podeVer) return <PageShell><p className="text-sm text-muted">Seu perfil de acesso não inclui relatórios.</p></PageShell>;

  const podio = q.data?.ranking.slice(0, 3) ?? [];
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'name' && key !== 'avgHandleMin' }));

  return (
    <PageShell width="max-w-6xl">
      <PageHeader
        title="Ranking de consultores"
        subtitle={`Quem mais concluiu atendimentos e vendeu no período. Pódio por vendas (${labels.won}); empate desempata por concluídos.`}
        action={<Link href="/relatorios" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Relatórios</Link>}
      />

      <section className="rounded-2xl bg-panel border border-line p-3 space-y-3">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => { setPreset(p.key); setRange(p.range()); }} className={cn('text-xs font-semibold px-2.5 py-1.5 rounded-lg border', preset === p.key ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>{p.label}</button>
          ))}
          <button type="button" onClick={() => setPreset('custom')} className={cn('text-xs font-semibold px-2.5 py-1.5 rounded-lg border', preset === 'custom' ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>Personalizado</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {preset === 'custom' && (
            <>
              <Field label="Data inicial">
                <input type="date" className={inputCls} value={range[0]} max={shift(range[1], -1)} onChange={(e) => e.target.value && setRange([e.target.value, range[1]])} />
              </Field>
              {/* final inclusiva na tela; a API recebe o dia seguinte */}
              <Field label="Data final">
                <input type="date" className={inputCls} value={shift(range[1], -1)} min={range[0]} onChange={(e) => e.target.value && setRange([range[0], shift(e.target.value, 1)])} />
              </Field>
            </>
          )}
          <Field label="Tag">
            <TagPicker tags={tags.data ?? []} value={tagIds} onChange={setTagIds} placeholder="Todas as tags" />
          </Field>
        </div>
      </section>

      {q.isLoading && <SkeletonCards count={3} />}
      {q.data && (
        <>
          {podio.length ? (
            <div className="grid gap-3 sm:grid-cols-3 items-end">
              {/* 2º, 1º, 3º: o campeão no meio e mais alto */}
              {[podio[1], podio[0], podio[2]].map((r, i) => r ? <PodiumCard key={r.userId} row={r} wonLabel={labels.won} /> : <div key={i} className="hidden sm:block" />)}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-line bg-panel p-10 text-center text-sm text-muted">Nenhum atendimento encerrado por consultor no período.</p>
          )}

          {rows.length > 0 && (
            <section className="rounded-2xl bg-panel border border-line overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                  <tr>
                    <th className="py-2.5 pl-4 pr-2 w-10">#</th>
                    <Th label="Nome" k="name" sort={sort} onClick={toggle} />
                    <Th label="Concluídos" k="closed" sort={sort} onClick={toggle} right />
                    <Th label="Vendas" k="won" sort={sort} onClick={toggle} right />
                    <Th label="Conversão" k="conversionRate" sort={sort} onClick={toggle} right />
                    <Th label="TMA" k="avgHandleMin" sort={sort} onClick={toggle} right />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.userId} className="hover:bg-field/50">
                      <td className="py-2.5 pl-4 pr-2 tnum text-muted">{r.position}º</td>
                      <td className="py-2.5 px-2 text-ink font-medium">{r.name}</td>
                      <td className="py-2.5 px-2 text-right tnum">{r.closed}</td>
                      <td className="py-2.5 px-2 text-right tnum">{r.won}</td>
                      <td className="py-2.5 px-2 text-right tnum">
                        <div className="inline-flex items-center gap-2">
                          <span className="hidden md:block w-16 h-1.5 rounded-full bg-field overflow-hidden"><span className="block h-full bg-accent" style={{ width: `${Math.min(100, r.conversionRate)}%` }} /></span>
                          {fmtPct(r.conversionRate)}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 pr-4 text-right tnum text-muted">{fmtMin(r.avgHandleMin)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line text-xs text-muted">
                  <tr>
                    <td className="py-2 pl-4" colSpan={2}>Equipe</td>
                    <td className="py-2 px-2 text-right tnum">{q.data.totals.closed}</td>
                    <td className="py-2 px-2 text-right tnum">{q.data.totals.won}</td>
                    <td className="py-2 px-2 text-right tnum">{fmtPct(q.data.totals.conversionRate)}</td>
                    <td className="py-2 px-2 pr-4" />
                  </tr>
                </tfoot>
              </table>
            </section>
          )}
          <p className="text-[11px] text-faint">Concluídos = atendimentos encerrados pelo consultor (encerramento automático e interno não contam). Conversão = vendas ÷ concluídos. TMA = do início do atendimento (ou da reabertura) até o encerramento.</p>
        </>
      )}
    </PageShell>
  );
}

const PODIO = [
  { icon: Crown, cls: 'sm:pb-8 border-amber-400/60 bg-gradient-to-b from-amber-400/15 to-transparent', badge: 'bg-amber-400 text-amber-950' },
  { icon: Medal, cls: 'sm:pb-4 border-slate-400/60 bg-gradient-to-b from-slate-400/15 to-transparent', badge: 'bg-slate-300 text-slate-900' },
  { icon: Trophy, cls: 'border-orange-500/50 bg-gradient-to-b from-orange-500/15 to-transparent', badge: 'bg-orange-400 text-orange-950' },
];

function PodiumCard({ row, wonLabel }: { row: ConsultantRankingRow; wonLabel: string }) {
  const p = PODIO[row.position - 1];
  const Icon = p.icon;
  return (
    <div className={cn('rounded-2xl border bg-panel p-4 text-center', p.cls, row.position === 1 ? 'order-first sm:order-none' : '')}>
      <div className={cn('mx-auto mb-2 w-10 h-10 rounded-full grid place-items-center', p.badge)}><Icon size={20} /></div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{row.position}º lugar</div>
      <div className="font-display font-semibold text-ink truncate">{row.name}</div>
      <div className="mt-2 text-3xl font-semibold tnum text-ink">{row.won}</div>
      <div className="text-[11px] text-muted">{wonLabel.toLowerCase()}</div>
      <div className="mt-2 flex justify-center gap-3 text-[12px] text-muted tnum">
        <span>{row.closed} concluídos</span>
        <span>{fmtPct(row.conversionRate)} conv.</span>
      </div>
    </div>
  );
}

function Th({ label, k, sort, onClick, right }: { label: string; k: SortKey; sort: { key: SortKey; desc: boolean }; onClick: (k: SortKey) => void; right?: boolean }) {
  const on = sort.key === k;
  return (
    <th className={cn('py-2.5 px-2', right && 'text-right', k === 'avgHandleMin' && 'pr-4')}>
      <button type="button" onClick={() => onClick(k)} className={cn('inline-flex items-center gap-1 uppercase hover:text-ink', on && 'text-ink')}>
        {label}{on && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
      </button>
    </th>
  );
}
