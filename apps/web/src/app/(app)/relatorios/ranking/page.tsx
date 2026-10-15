'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RANKING_METRICS, RANKING_METRIC_HINT, RANKING_METRIC_LABEL, RANKING_WEIGHTS_DEFAULT, type RankingWeights } from '@atendo/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import Link from 'next/link';
import { ArrowLeft, ArrowDown, ArrowUp, Crown, Medal, Trophy, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Field, inputCls } from '@/components/ui/Modal';
import { TagPicker } from '@/components/chat/TagPicker';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { useCan, useConsultantRanking, useHasFeature, useOutcomeLabels, useTags, useUpdateTenantSettings, type ConsultantRankingRow } from '@/lib/hooks';
import { FeatureLocked } from '@/components/billing/FeatureLocked';
import { GoalsBoard } from '@/components/reports/GoalsBoard';

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

type SortKey = 'score' | 'name' | 'closed' | 'won' | 'revenue' | 'conversionRate' | 'avgHandleMin' | 'satisfaction';
const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const fmtMin = (m: number | null) => (m == null ? '—' : m < 60 ? `${m.toFixed(0)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`);
const fmtPct = (v: number) => `${v.toFixed(v % 1 ? 1 : 0)}%`;

export default function RankingPage() {
  const podeVer = useCan('reports.view');
  const feature = useHasFeature('consultant_ranking');
  const satisfacao = useHasFeature('satisfaction_surveys');
  const [aba, setAba] = useState<'ranking' | 'metas'>('ranking');
  const labels = useOutcomeLabels();
  const tags = useTags();
  const [preset, setPreset] = useState('mes');
  const [range, setRange] = useState<[string, string]>(PRESETS[2].range());
  const [tagIds, setTagIds] = useState<string[]>([]);
  // a posição é a pontuação; as outras colunas só reordenam a tabela para conferir
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'score', desc: true });
  const [pesos, setPesos] = useState(false);
  const podePesos = useCan('settings.manage');
  const q = useConsultantRanking({ from: inicioDoDia(range[0]), to: inicioDoDia(range[1]), tagIds, enabled: feature.has && aba === 'ranking' });

  const rows = useMemo(() => {
    const list = [...(q.data?.ranking ?? [])];
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      if (sort.key === 'name') return dir * a.name.localeCompare(b.name, 'pt-BR');
      if (sort.key === 'satisfaction') return dir * ((a.satisfaction?.avg ?? (sort.desc ? -Infinity : Infinity)) - (b.satisfaction?.avg ?? (sort.desc ? -Infinity : Infinity))) || a.position - b.position;
      // sem TMA vai sempre para o fim
      const va = a[sort.key] ?? (sort.desc ? -Infinity : Infinity);
      const vb = b[sort.key] ?? (sort.desc ? -Infinity : Infinity);
      return dir * ((va as number) - (vb as number)) || a.position - b.position;
    });
  }, [q.data, sort]);

  if (!podeVer) return <PageShell><p className="text-sm text-muted">Seu perfil de acesso não inclui relatórios.</p></PageShell>;
  if (!feature.loading && !feature.has) return <FeatureLocked title="Ranking de consultores" text="Pódio de vendas, conversão e TMA de cada consultor, com metas mensais e quanto falta para batê-las." />;

  const podio = q.data?.ranking.slice(0, 3) ?? [];
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'name' && key !== 'avgHandleMin' }));
  const composicao = (r: ConsultantRankingRow, w: RankingWeights) => RANKING_METRICS.filter((k) => w[k]).map((k) => `${RANKING_METRIC_LABEL[k]}: ${r.scoreParts?.[k] == null ? 'sem dado' : `${r.scoreParts[k]!.toFixed(0)}/100`} (peso ${w[k]})`).join('\n');

  const escala = q.data?.satisfactionScale;
  const comNota = satisfacao.has && !!escala;
  const fmtNota = (r: ConsultantRankingRow) => !r.satisfaction ? '—' : escala === 'scale_10' && r.satisfaction.nps != null ? `${r.satisfaction.avg?.toFixed(1) ?? '—'} · NPS ${r.satisfaction.nps}` : escala === 'csat_3' ? `${r.satisfaction.avg?.toFixed(1) ?? '—'}/3` : `${r.satisfaction.avg?.toFixed(1) ?? '—'}/5`;

  return (
    <PageShell width="max-w-6xl">
      <PageHeader
        title="Ranking de consultores"
        subtitle="Posição pela pontuação (0 a 100): faturamento, vendas, conversão, satisfação e tempo de atendimento, com os pesos da empresa."
        action={
          <div className="flex items-center gap-3">
            {podePesos && <button type="button" onClick={() => setPesos(true)} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><SlidersHorizontal size={15} /> Pesos</button>}
            <Link href="/relatorios" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Relatórios</Link>
          </div>
        }
      />

      <div className="flex gap-1 border-b border-line">
        {([['ranking', 'Ranking do período'], ['metas', 'Metas do mês']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setAba(k)} className={cn('px-3 py-2 text-sm font-medium border-b-2 -mb-px', aba === k ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}>{l}</button>
        ))}
      </div>

      {aba === 'metas' ? <GoalsBoard /> : <>
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
            <TagPicker field tags={tags.data ?? []} value={tagIds} onChange={setTagIds} placeholder="Todas as tags" />
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
                    <Th label="Pontuação" k="score" sort={sort} onClick={toggle} right />
                    <Th label="Concluídos" k="closed" sort={sort} onClick={toggle} right />
                    <Th label="Vendas" k="won" sort={sort} onClick={toggle} right />
                    <Th label="Faturamento" k="revenue" sort={sort} onClick={toggle} right />
                    <Th label="Conversão" k="conversionRate" sort={sort} onClick={toggle} right />
                    <Th label="TMA" k="avgHandleMin" sort={sort} onClick={toggle} right />
                    {comNota && <Th label={escala === 'scale_10' ? 'Satisfação / NPS' : 'Satisfação'} k="satisfaction" sort={sort} onClick={toggle} right />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.userId} className="hover:bg-field/50">
                      <td className="py-2.5 pl-4 pr-2 tnum text-muted">{r.position}º</td>
                      <td className="py-2.5 px-2 text-ink font-medium">{r.name}</td>
                      <td className="py-2.5 px-2 text-right tnum font-semibold text-ink" title={composicao(r, q.data!.weights)}>{r.score.toFixed(1)}</td>
                      <td className="py-2.5 px-2 text-right tnum">{r.closed}</td>
                      <td className="py-2.5 px-2 text-right tnum">{r.won}</td>
                      <td className="py-2.5 px-2 text-right tnum">{fmtBRL(r.revenue)}</td>
                      <td className="py-2.5 px-2 text-right tnum">
                        <div className="inline-flex items-center gap-2">
                          <span className="hidden md:block w-16 h-1.5 rounded-full bg-field overflow-hidden"><span className="block h-full bg-accent" style={{ width: `${Math.min(100, r.conversionRate)}%` }} /></span>
                          {fmtPct(r.conversionRate)}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 pr-4 text-right tnum text-muted">{fmtMin(r.avgHandleMin)}</td>
                      {comNota && <td className="py-2.5 px-2 pr-4 text-right tnum" title={r.satisfaction ? `${r.satisfaction.answered} respostas` : 'Sem respostas da pesquisa no período'}>{fmtNota(r)}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line text-xs text-muted">
                  <tr>
                    <td className="py-2 pl-4" colSpan={3}>Equipe</td>
                    <td className="py-2 px-2 text-right tnum">{q.data.totals.closed}</td>
                    <td className="py-2 px-2 text-right tnum">{q.data.totals.won}</td>
                    <td className="py-2 px-2 text-right tnum">{fmtBRL(q.data.totals.revenue)}</td>
                    <td className="py-2 px-2 text-right tnum">{fmtPct(q.data.totals.conversionRate)}</td>
                    <td className="py-2 px-2 pr-4" />
                    {comNota && <td className="py-2 px-2 pr-4" />}
                  </tr>
                </tfoot>
              </table>
            </section>
          )}
          <p className="text-[11px] text-faint">Pontuação = média ponderada de cada métrica de 0 a 100 em relação ao melhor do período (passe o mouse para ver a composição); sem pesquisa ou sem TMA, o peso vai para as outras. Pesos: {RANKING_METRICS.filter((k) => q.data!.weights[k]).map((k) => `${RANKING_METRIC_LABEL[k]} ${q.data!.weights[k]}`).join(' · ')}. Concluídos = atendimentos encerrados pelo consultor (encerramento automático e interno não contam) + orçamentos pagos ainda sem encerramento. Conversão = vendas ÷ concluídos. TMA = do início do atendimento (ou da reabertura) até o encerramento.{comNota && ' Satisfação = média da pergunta principal da pesquisa de satisfação (escala mais usada no período); NPS só na escala de 1 a 10.'}</p>
        </>
      )}
      </>}
      {pesos && q.data && <PesosModal atuais={q.data.weights} onClose={() => setPesos(false)} />}
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
      <div className="mt-2 text-3xl font-semibold tnum text-ink">{row.score.toFixed(1)}</div>
      <div className="text-[11px] text-muted">pontos · {row.won} {wonLabel.toLowerCase()} · {fmtBRL(row.revenue)}</div>
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

/** Pesos da pontuação (gestão — `settings.manage`). Cada um de 0 a 100; o que vale é a proporção entre eles. */
function PesosModal({ atuais, onClose }: { atuais: RankingWeights; onClose: () => void }) {
  const [w, setW] = useState<RankingWeights>(atuais);
  useEffect(() => setW(atuais), [atuais]);
  const update = useUpdateTenantSettings();
  const qc = useQueryClient();
  const total = RANKING_METRICS.reduce((a, k) => a + (w[k] || 0), 0);
  async function salvar() {
    try {
      await update.mutateAsync({ rankingWeights: w });
      await qc.invalidateQueries({ queryKey: ['consultant-ranking'] });
      toast.ok('Pesos salvos — o ranking já reordenou');
      onClose();
    } catch (e) { toast.err(e); }
  }
  return (
    <Modal open onClose={onClose} title="Pesos da pontuação">
      <div className="space-y-3 text-sm">
        <p className="text-muted">Quanto cada métrica pesa na posição. Vale a proporção: 40 e 20 é o mesmo que 2 e 1. Zero tira a métrica da conta.</p>
        {RANKING_METRICS.map((k) => (
          <label key={k} className="flex items-center gap-3">
            <span className="flex-1 min-w-0">
              <span className="block font-medium text-ink">{RANKING_METRIC_LABEL[k]}</span>
              <span className="block text-xs text-muted">{RANKING_METRIC_HINT[k]}</span>
            </span>
            <input type="number" min={0} max={100} className={cn(inputCls, 'w-20 text-right tnum')} value={w[k]} onChange={(e) => setW({ ...w, [k]: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} aria-label={`Peso de ${RANKING_METRIC_LABEL[k]}`} />
            <span className="w-12 text-right text-xs text-muted tnum">{total ? `${Math.round(((w[k] || 0) / total) * 100)}%` : '—'}</span>
          </label>
        ))}
        {!total && <p className="text-xs text-danger-ink">Pelo menos uma métrica precisa de peso.</p>}
        <div className="flex items-center justify-between pt-1">
          <button type="button" className="text-xs text-muted hover:text-ink hover:underline" onClick={() => setW({ ...RANKING_WEIGHTS_DEFAULT })}>Voltar ao padrão</button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={salvar} disabled={!total} loading={update.isPending}>Salvar</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
