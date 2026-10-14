'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MessageSquareQuote, Settings2 } from 'lucide-react';
import { SURVEY_SCALE_LABEL, SURVEY_SCALE_MAX, type SurveyScale } from '@atendo/shared';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Field, inputCls } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { useAgents, useCan, useSatisfactionReport, useSurveys } from '@/lib/hooks';
import { useUI } from '@/lib/store';

// mesmas regras de data da tela de Relatórios: fuso do navegador, fim exclusivo
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = (dia: string, n: number) => { const d = new Date(`${dia}T00:00:00`); d.setDate(d.getDate() + n); return iso(d); };
const inicioDoDia = (dia: string) => new Date(`${dia}T00:00:00`).toISOString();
const hoje = () => iso(new Date());
const PRESETS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: '7d', label: 'Últimos 7 dias', range: () => [shift(hoje(), -6), shift(hoje(), 1)] },
  { key: '30d', label: 'Últimos 30 dias', range: () => [shift(hoje(), -29), shift(hoje(), 1)] },
  { key: 'mes', label: 'Mês atual', range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(new Date(n.getFullYear(), n.getMonth() + 1, 1))]; } },
];
const PAGE_SIZE = 20;
const fmtPct = (v: number | null) => (v == null ? '—' : `${v.toFixed(v % 1 ? 1 : 0)}%`);
const fmtNota = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const CSAT3: Record<number, string> = { 1: 'Ruim', 2: 'Neutro', 3: 'Bom' };
const rotuloNota = (scale: SurveyScale, n: number) => (scale === 'csat_3' ? CSAT3[n] : String(n));

/** cor da nota: vermelho → âmbar → verde, na régua da escala */
function corDaNota(scale: SurveyScale, n: number) {
  const max = SURVEY_SCALE_MAX[scale];
  const r = (n - 1) / (max - 1);
  return r >= 0.75 ? 'bg-ok text-white' : r >= 0.45 ? 'bg-warn text-white' : 'bg-danger text-white';
}

/** Relatório de satisfação (docs/pesquisa-de-satisfacao.md#relatório): média global, por consultor e comentários. */
export default function SatisfactionReportPage() {
  const podeVer = useCan('reports.view');
  const router = useRouter();
  const { setConversation } = useUI();
  const agents = useAgents();
  const surveys = useSurveys();
  const [preset, setPreset] = useState('30d');
  const [range, setRange] = useState<[string, string]>(PRESETS[1].range());
  const [scale, setScale] = useState<SurveyScale | undefined>();
  const [surveyId, setSurveyId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [nota, setNota] = useState<[number | undefined, number | undefined]>([undefined, undefined]);
  const [soComentarios, setSoComentarios] = useState(true);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [range, scale, surveyId, agentId, nota, soComentarios]);

  const q = useSatisfactionReport({ from: inicioDoDia(range[0]), to: inicioDoDia(range[1]), scale, surveyId: surveyId || undefined, agentId: agentId || undefined, scoreMin: nota[0], scoreMax: nota[1], onlyComments: soComentarios, page });
  const d = q.data;
  const escala = d?.scale ?? scale ?? 'scale_5';
  const max = SURVEY_SCALE_MAX[escala];

  if (!podeVer) return <PageShell><p className="text-sm text-muted">Seu perfil de acesso não inclui relatórios.</p></PageShell>;

  const totalDist = d ? Math.max(1, ...d.totals.distribution.map((x) => x.count)) : 1;
  const chip = (on: boolean) => cn('text-xs font-semibold px-2.5 py-1.5 rounded-lg border', on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field');

  return (
    <PageShell width="max-w-6xl">
      <PageHeader
        title="Satisfação dos clientes"
        subtitle="Notas das pesquisas enviadas ao encerrar o atendimento, da equipe e de cada consultor."
        action={
          <div className="flex items-center gap-3">
            <Link href="/pesquisas" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><Settings2 size={15} /> Pesquisas</Link>
            <Link href="/relatorios" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Relatórios</Link>
          </div>
        }
      />

      <section className="rounded-2xl bg-panel border border-line p-3 space-y-3">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => <button key={p.key} type="button" onClick={() => { setPreset(p.key); setRange(p.range()); }} className={chip(preset === p.key)}>{p.label}</button>)}
          <button type="button" onClick={() => setPreset('custom')} className={chip(preset === 'custom')}>Personalizado</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {preset === 'custom' && (
            <>
              <Field label="Data inicial">
                <input type="date" className={inputCls} value={range[0]} max={shift(range[1], -1)} onChange={(e) => e.target.value && setRange([e.target.value, range[1]])} />
              </Field>
              <Field label="Data final">
                <input type="date" className={inputCls} value={shift(range[1], -1)} min={range[0]} onChange={(e) => e.target.value && setRange([range[0], shift(e.target.value, 1)])} />
              </Field>
            </>
          )}
          <Field label="Pesquisa">
            <select className={inputCls} value={surveyId} onChange={(e) => setSurveyId(e.target.value)}>
              <option value="">Todas</option>
              {surveys.data?.map((s) => <option key={s.id} value={s.id}>{s.name}{!s.isActive ? ' (desativada)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Consultor">
            <select className={inputCls} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Toda a equipe</option>
              {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        </div>
        {/* escalas diferentes não se misturam numa média */}
        {d && d.scales.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-muted mr-1">Escala:</span>
            {d.scales.map((s) => <button key={s.scale} type="button" onClick={() => { setScale(s.scale); setNota([undefined, undefined]); }} className={chip(escala === s.scale)}>{SURVEY_SCALE_LABEL[s.scale]} · {s.count}</button>)}
          </div>
        )}
      </section>

      {q.isLoading && <SkeletonCards count={4} />}
      {d && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Kpi titulo="Nota média" valor={escala === 'csat_3' ? fmtPct(d.totals.satisfiedPct) : fmtNota(d.totals.avg)} sub={escala === 'csat_3' ? 'responderam “Bom”' : `de ${max} · ${d.totals.answered} respostas`} />
            {escala === 'scale_10'
              ? <Kpi titulo="NPS" valor={d.totals.nps == null ? '—' : String(d.totals.nps)} sub="% promotores (9–10) − % detratores (1–6)" />
              : <Kpi titulo="Satisfeitos" valor={fmtPct(d.totals.satisfiedPct)} sub={escala === 'csat_3' ? `${d.totals.answered} respostas` : `nota ${escala === 'scale_5' ? '4 ou 5' : '≥ 9'}`} />}
            <Kpi titulo="Taxa de resposta" valor={fmtPct(d.totals.responseRate)} sub={`${d.totals.answered} de ${d.totals.sent} enviadas`} />
            <Kpi titulo="Recusas" valor={fmtPct(d.totals.declineRate)} sub={`${d.totals.declined} recusaram · ${d.totals.noResponse} sem resposta${d.totals.waiting ? ` · ${d.totals.waiting} aguardando` : ''}`} />
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
            <section className="rounded-2xl bg-panel border border-line p-4">
              <h2 className="text-sm font-semibold text-ink mb-3">Distribuição das notas</h2>
              {d.totals.answered === 0 ? <p className="text-sm text-muted">Nenhuma resposta no período.</p> : (
                <div className="space-y-1.5">
                  {[...d.totals.distribution].reverse().map((x) => (
                    <div key={x.score} className="flex items-center gap-2 text-[12.5px]">
                      <span className="w-12 text-right text-muted tnum">{rotuloNota(escala, x.score)}</span>
                      <span className="flex-1 h-3 rounded bg-field overflow-hidden"><span className={cn('block h-full rounded', corDaNota(escala, x.score))} style={{ width: `${(x.count / totalDist) * 100}%` }} /></span>
                      <span className="w-8 text-right tnum text-ink">{x.count}</span>
                    </div>
                  ))}
                </div>
              )}
              {d.totals.failed > 0 && <p className="mt-3 text-[11px] text-faint">{d.totals.failed} pesquisa(s) não saíram (número desconectado, fora da janela da Meta ou contato descadastrado) e não entram nos números.</p>}
            </section>

            <section className="rounded-2xl bg-panel border border-line overflow-x-auto">
              <h2 className="text-sm font-semibold text-ink px-4 pt-4 pb-2">Por consultor</h2>
              {d.byAgent.length === 0 ? <p className="px-4 pb-4 text-sm text-muted">Nenhuma pesquisa enviada no período.</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                    <tr>
                      <th className="py-2 pl-4 pr-2">Consultor</th>
                      <th className="py-2 px-2 text-right">{escala === 'csat_3' ? '% Bom' : 'Média'}</th>
                      {escala === 'scale_10' && <th className="py-2 px-2 text-right">NPS</th>}
                      <th className="py-2 px-2 text-right">Respostas</th>
                      <th className="py-2 px-2 text-right">Resposta</th>
                      <th className="py-2 px-2 pr-4 text-right">Recusas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.byAgent.map((r) => (
                      <tr key={r.agentId ?? 'sem'} className={cn('hover:bg-field/50 cursor-pointer', agentId && r.agentId === agentId && 'bg-accent-soft/40')} onClick={() => r.agentId && setAgentId(r.agentId === agentId ? '' : r.agentId)} title="Filtrar os comentários por este consultor">
                        <td className="py-2 pl-4 pr-2 text-ink font-medium">{r.name}</td>
                        <td className="py-2 px-2 text-right tnum font-semibold">{escala === 'csat_3' ? fmtPct(r.satisfiedPct) : fmtNota(r.avg)}</td>
                        {escala === 'scale_10' && <td className="py-2 px-2 text-right tnum">{r.nps ?? '—'}</td>}
                        <td className="py-2 px-2 text-right tnum">{r.answered}<span className="text-faint">/{r.sent}</span></td>
                        <td className="py-2 px-2 text-right tnum text-muted">{fmtPct(r.responseRate)}</td>
                        <td className="py-2 px-2 pr-4 text-right tnum text-muted">{fmtPct(r.declineRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {d.extraQuestions.length > 0 && (
            <section className="rounded-2xl bg-panel border border-line p-4">
              <h2 className="text-sm font-semibold text-ink mb-3">Outras perguntas</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {d.extraQuestions.map((x) => {
                  const maior = Math.max(1, ...x.distribution.map((y) => y.count));
                  return (
                    <div key={`${x.questionId}-${x.scale}`} className="rounded-xl border border-line p-3">
                      <p className="text-[13px] text-ink line-clamp-2">{x.question}</p>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-xl font-semibold tnum text-ink">{x.scale === 'csat_3' ? fmtPct(x.satisfiedPct) : fmtNota(x.avg)}</span>
                        <span className="text-[11.5px] text-muted">{x.scale === 'csat_3' ? 'responderam “Bom”' : `de ${SURVEY_SCALE_MAX[x.scale]}`}{x.nps != null ? ` · NPS ${x.nps}` : ''} · {x.answered} respostas</span>
                      </div>
                      <div className="mt-2 flex items-end gap-1 h-10">
                        {x.distribution.map((y) => <span key={y.score} title={`${rotuloNota(x.scale, y.score)}: ${y.count}`} className={cn('flex-1 rounded-sm', corDaNota(x.scale, y.score))} style={{ height: `${Math.max(4, (y.count / maior) * 100)}%`, opacity: y.count ? 1 : 0.2 }} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="rounded-2xl bg-panel border border-line">
            <div className="flex flex-wrap items-end gap-3 px-4 pt-4 pb-3 border-b border-line">
              <h2 className="text-sm font-semibold text-ink mr-auto inline-flex items-center gap-1.5"><MessageSquareQuote size={15} className="text-accent" /> Feedbacks dos clientes</h2>
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <span className="text-muted mr-1">Nota:</span>
                <button type="button" onClick={() => setNota([undefined, undefined])} className={chip(!nota[0] && !nota[1])}>Todas</button>
                {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" onClick={() => setNota(nota[0] === n && nota[1] === n ? [undefined, undefined] : [n, n])} className={chip(nota[0] === n && nota[1] === n)}>{rotuloNota(escala, n)}</button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                <input type="checkbox" checked={soComentarios} onChange={(e) => setSoComentarios(e.target.checked)} /> Só com comentário
              </label>
            </div>
            {d.comments.rows.length === 0 ? <p className="p-6 text-center text-sm text-muted">Nenhum feedback com esses filtros.</p> : (
              <ul className="divide-y divide-line">
                {d.comments.rows.map((c) => (
                  <li key={c.id} className="px-4 py-3 flex gap-3">
                    <span className={cn('shrink-0 h-8 min-w-8 px-1.5 rounded-lg grid place-items-center text-[13px] font-semibold tnum', corDaNota(escala, c.score))}>{rotuloNota(escala, c.score)}</span>
                    <div className="min-w-0 flex-1">
                      {c.comment ? <p className="text-[13.5px] text-ink whitespace-pre-line break-words">“{c.comment}”</p> : <p className="text-[13px] text-faint italic">Sem comentário</p>}
                      <p className="mt-1 text-[11.5px] text-muted">
                        <button type="button" onClick={() => { setConversation(c.conversationId); router.push('/conversas'); }} className="hover:underline text-ink/80" title="Abrir conversa">{c.contact.name || c.contact.phone}</button>
                        {c.agent?.name && <> · atendido por {c.agent.name}</>}
                        {c.answeredAt && <> · {new Date(c.answeredAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</>}
                        <span className="text-faint"> · {c.surveyName}</span>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {d.comments.total > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-line text-xs text-muted">
                <span>{d.comments.total} no total</span>
                <div className="flex gap-1">
                  <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={chip(false)}>Anterior</button>
                  <button type="button" disabled={page * PAGE_SIZE >= d.comments.total} onClick={() => setPage((p) => p + 1)} className={chip(false)}>Próxima</button>
                </div>
              </div>
            )}
          </section>
          <p className="text-[11px] text-faint">Base: pesquisas enviadas no período. O consultor é o dono do atendimento no encerramento. Taxa de resposta = notas ÷ enviadas; recusa = “0” ou “Não responder”.</p>
        </>
      )}
    </PageShell>
  );
}

function Kpi({ titulo, valor, sub }: { titulo: string; valor: string; sub: string }) {
  return (
    <div className="rounded-2xl bg-panel border border-line p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{titulo}</div>
      <div className="mt-1 text-2xl font-semibold tnum text-ink">{valor}</div>
      <div className="text-[11.5px] text-muted">{sub}</div>
    </div>
  );
}
