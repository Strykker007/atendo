'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Play, Save, Download, BarChart3, LineChart as LineIcon, PieChart as PieIcon, Bookmark, Trash2, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { TagPicker } from '@/components/chat/TagPicker';
import { ReportChart, METRIC_LABEL, GROUP_LABEL, fmtLabel, fmtBRL } from '@/components/reports/ReportChart';
import { useAgents, useCan, useNumbers, useTags, useRunReport, useSavedReports, useSaveReport, useDeleteSavedReport, useReportOverview, useReportCompanies, useReportCompanyOptions, useOutcomeLabels, useHasFeature, useTenantSettings, type CompanyReportRow, type ReportDefinition, type ReportResult, type SavedReport } from '@/lib/hooks';
import { useUI } from '@/lib/store';
import { Building2 } from 'lucide-react';
import { MessageSquare, Clock, CheckCircle2, Inbox, ChevronDown, ChevronUp, SlidersHorizontal, DollarSign, Receipt, Target, Trophy, ThumbsUp, Wallet, EyeOff } from 'lucide-react';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { SalesDetails } from '@/components/reports/SalesDetails';
import { Attendances, type AttendanceFocus } from '@/components/reports/Attendances';

// datas no fuso do navegador: `toISOString` dava o dia UTC, e depois das 21h "hoje" já era amanhã
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = (dia: string, n: number) => { const d = new Date(`${dia}T00:00:00`); d.setDate(d.getDate() + n); return iso(d); };
/** "AAAA-MM-DD" → instante do início desse dia no fuso local. É o que vai para a API. */
const inicioDoDia = (dia: string) => new Date(`${dia}T00:00:00`).toISOString();
const hoje = () => iso(new Date());
/** [início, fim exclusivo] em "AAAA-MM-DD" */
const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: 'Hoje', range: () => [hoje(), shift(hoje(), 1)] },
  { label: 'Ontem', range: () => [shift(hoje(), -1), hoje()] },
  { label: '7 dias', range: () => [shift(hoje(), -6), shift(hoje(), 1)] },
  { label: '30 dias', range: () => [shift(hoje(), -29), shift(hoje(), 1)] },
  { label: 'Este mês', range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(new Date(n.getFullYear(), n.getMonth() + 1, 1))]; } },
  { label: 'Mês passado', range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 1))]; } },
];
const DEFAULT: ReportDefinition = { metric: 'conversations', groupBy: 'day', from: PRESETS[3].range()[0], to: PRESETS[3].range()[1], filters: {}, chart: 'line' };
const TIME_GROUPS = ['day', 'week', 'month'];

export default function RelatoriosPage() {
  // sem a permissão a API devolve 403: melhor dizer o motivo do que mostrar gráfico vazio
  const podeVer = useCan('reports.view');
  const [def, setDef] = useState<ReportDefinition>(DEFAULT);
  const [result, setResult] = useState<ReportResult | null>(null);
  // abre no dia de hoje; o calendário cobre qualquer período
  const [range, setRange] = useState<[string, string]>(PRESETS[0].range());
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [agentId, setAgentId] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  /** clique numa tag do "Não comprou, por tag" → auditoria filtrada */
  const [foco, setFoco] = useState<AttendanceFocus | null>(null);
  const periodo = { from: inicioDoDia(range[0]), to: inicioDoDia(range[1]) };
  // Empresa: filtro da própria página, independente do seletor do menu (começa nele). Lista as
  // empresas que a pessoa opera e as removidas que ainda têm histórico (docs/empresas.md#relatórios)
  const doMenu = useUI((s) => s.companyId);
  const opcoesEmpresa = useReportCompanyOptions();
  const empresas = opcoesEmpresa.data ?? [];
  const [empresa, setEmpresa] = useState<string>(() => doMenu ?? 'all');
  const temEmpresas = empresas.length > 0;
  const empresaAtual = empresas.find((c) => c.id === empresa);
  const filtros = { tagIds: tagIds.length ? tagIds : undefined, agentId: agentId || undefined, companyId: temEmpresas ? empresa : undefined };
  const overview = useReportOverview({ ...periodo, ...filtros });
  // todas as empresas: compara lado a lado
  const porEmpresa = useReportCompanies({ ...periodo, ...filtros }, temEmpresas && empresa === 'all');
  const agents = useAgents();
  const temRanking = useHasFeature('consultant_ranking').has;
  const temSatisfacao = useHasFeature('satisfaction_surveys').has;
  // atendimentos internos: auditoria de quem tirou atendimento dos relatórios (mesma regra da API)
  const podeAuditar = useCan('profiles.manage');
  const labels = useOutcomeLabels();
  // encerramento sem venda (condomínio, suporte): some faturamento, ticket e pagamentos; o resto
  // (resultado, conversão, motivos) segue com os nomes da empresa (docs/06-modelo-de-dados.md#encerramento-sem-venda)
  const vendas = useTenantSettings().data?.salesEnabled ?? true;
  // "Comprou"/"Não comprou" levam o nome que a empresa deu ao resultado
  const metricLabel = vendas
    ? { ...METRIC_LABEL, lost: labels.lost }
    : { ...METRIC_LABEL, won: labels.won, lost: labels.lost, win_rate: `Taxa de “${labels.won}”` };
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<SavedReport | null>(null);
  const run = useRunReport();
  const save = useSaveReport();
  const remove = useDeleteSavedReport();
  const saved = useSavedReports();
  const numbers = useNumbers();
  const tags = useTags();

  const set = <K extends keyof ReportDefinition>(k: K, v: ReportDefinition[K]) => setDef((d) => ({ ...d, [k]: v }));
  const setFilter = <K extends keyof ReportDefinition['filters']>(k: K, v: ReportDefinition['filters'][K]) => setDef((d) => ({ ...d, filters: { ...d.filters, [k]: v || undefined } }));

  async function execute(d = def) {
    try {
      setResult(await run.mutateAsync({ ...d, companyId: filtros.companyId }));
    } catch (err) {
      toast.err(err);
    }
  }

  // agrupamento por tempo → linha; por categoria → barra (o usuário pode trocar depois no resultado)
  useEffect(() => {
    setDef((d) => ({ ...d, chart: TIME_GROUPS.includes(d.groupBy) ? 'line' : 'bar' }));
  }, [def.groupBy]);

  const total = useMemo(() => result?.series.reduce((a, s) => a + s.value, 0) ?? 0, [result]);
  const isAvg = result?.definition.metric === 'avg_first_response_min';
  const isRate = result?.definition.metric === 'win_rate';
  const isBRL = result?.definition.metric === 'revenue';
  const fmtCelula = (v: number) => (isAvg ? v.toFixed(1) : isRate ? `${Math.round(v * 100)}%` : isBRL ? fmtBRL(v) : v.toLocaleString('pt-BR'));

  function exportCsv() {
    if (!result) return;
    const rows = [[GROUP_LABEL[result.definition.groupBy], metricLabel[result.definition.metric]], ...result.series.map((s) => [fmtLabel(result.definition.groupBy, s.label), String(s.value)])];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `atendo-${result.definition.metric}-por-${result.definition.groupBy}.csv`;
    a.click();
  }

  if (!podeVer) return <PageShell><p className="text-sm text-muted">Seu perfil de acesso não inclui relatórios.</p></PageShell>;

  return (
    <PageShell width="max-w-6xl">
      <PageHeader
        title="Relatórios"
        subtitle={empresaAtual ? `Só da empresa ${empresaAtual.name}. Tudo sai das conversas, mensagens e tags reais.` : temEmpresas ? 'Todas as empresas somadas — o quadro "Por empresa" separa cada uma.' : 'Como está o atendimento no período. Tudo sai das conversas, mensagens e tags reais.'}
        action={
          <div className="flex flex-wrap gap-2">
            {temSatisfacao && <Link href="/relatorios/satisfacao" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-medium text-ink hover:bg-field"><ThumbsUp size={15} className="text-accent" /> Satisfação</Link>}
            {vendas && <Link href="/relatorios/pagamentos" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-medium text-ink hover:bg-field"><Wallet size={15} className="text-accent" /> Pagamentos</Link>}
            {podeAuditar && <Link href="/relatorios/atendimentos-internos" title="Conversas fora dos relatórios (gestor com a equipe, fornecedor): quem encerrou assim e quando" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-medium text-ink hover:bg-field"><EyeOff size={15} className="text-accent" /> Atendimentos internos</Link>}
            {temRanking && <Link href="/relatorios/ranking" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-medium text-ink hover:bg-field"><Trophy size={15} className="text-accent" /> Ranking e metas</Link>}
          </div>
        }
      />

      {/* ---------- Filtros da tela inteira ---------- */}
      <section className="rounded-2xl bg-panel border border-line p-3 space-y-3">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => { const r = p.range(); const on = r[0] === range[0] && r[1] === range[1]; return <button key={p.label} type="button" onClick={() => setRange(r)} className={cn('text-xs font-semibold px-2.5 py-1.5 rounded-lg border', on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-field')}>{p.label}</button>; })}
        </div>
        <div className={cn('grid gap-2 sm:grid-cols-2', temEmpresas ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
          {temEmpresas && (
            <Field label="Empresa">
              <select className={inputCls} value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
                <option value="all">Todas as empresas</option>
                {empresas.filter((c) => !c.removed).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                {empresas.some((c) => c.removed) && (
                  <optgroup label="Removidas (histórico)">
                    {empresas.filter((c) => c.removed).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                )}
              </select>
            </Field>
          )}
          <Field label="Data inicial">
            <input type="date" className={inputCls} value={range[0]} max={shift(range[1], -1)} onChange={(e) => e.target.value && setRange([e.target.value, range[1]])} />
          </Field>
          {/* a final é inclusiva na tela; a API recebe o dia seguinte (fim exclusivo) */}
          <Field label="Data final">
            <input type="date" className={inputCls} value={shift(range[1], -1)} min={range[0]} onChange={(e) => e.target.value && setRange([range[0], shift(e.target.value, 1)])} />
          </Field>
          <Field label="Tag">
            <TagPicker field tags={tags.data ?? []} value={tagIds} onChange={setTagIds} placeholder="Todas as tags" />
          </Field>
          <Field label="Consultor">
            <select className={inputCls} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Todos os consultores</option>
              {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isActive ? '' : ' (inativo)'}</option>)}
            </select>
          </Field>
        </div>
      </section>

      {/* ---------- Visão pronta ---------- */}
      {overview.isLoading && <SkeletonCards count={4} />}
      {overview.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={<MessageSquare size={15} />} label="Atendimentos no período" value={overview.data.kpis.conversations.toLocaleString('pt-BR')} sub={`${overview.data.kpis.messagesIn.toLocaleString('pt-BR')} recebidas · ${overview.data.kpis.messagesOut.toLocaleString('pt-BR')} enviadas`} />
            <Kpi icon={<Inbox size={15} />} label="Na fila agora" value={String(overview.data.kpis.waitingNow)} sub={`${overview.data.kpis.inProgressNow} em atendimento`} tone={overview.data.kpis.waitingNow > 5 ? 'warn' : undefined} />
            <Kpi icon={<Clock size={15} />} label="1ª resposta (média)" value={overview.data.kpis.avgFirstResponseMin != null ? fmtMin(overview.data.kpis.avgFirstResponseMin) : '—'} sub="do contato escrever até a equipe responder" tone={overview.data.kpis.avgFirstResponseMin != null && overview.data.kpis.avgFirstResponseMin > 30 ? 'warn' : undefined} />
            <Kpi icon={<CheckCircle2 size={15} />} label="Encerradas" value={`${Math.round(overview.data.kpis.closeRate * 100)}%`} sub={`${overview.data.kpis.closed} de ${overview.data.kpis.conversations}`} />
          </div>

          {empresa === 'all' && porEmpresa.data && porEmpresa.data.rows.length > 1 && <PorEmpresa rows={porEmpresa.data.rows} onAbrir={setEmpresa} vendas={vendas} />}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Atendimentos por dia" hint="Conversas novas + contatos que voltaram"><ReportChart def={{ metric: 'conversations', groupBy: 'day', from: range[0], to: range[1], filters: {}, chart: 'line' }} series={overview.data.series.byDay} height={220} /></Card>
            <Card title="Atendimentos por atendente" hint="Encerrados no período, por quem encerrou"><ReportChart def={{ metric: 'closed', groupBy: 'agent', from: range[0], to: range[1], filters: {}, chart: 'bar' }} series={overview.data.series.byAgent} height={220} /></Card>
            <Card title="De onde vêm os leads" hint="Orgânico × anúncio × link"><ReportChart def={{ metric: 'conversations', groupBy: 'origin', from: range[0], to: range[1], filters: {}, chart: 'pie' }} series={overview.data.series.byOrigin} height={220} /></Card>
            <Card title={overview.data.series.byCampaign.length ? 'Leads por campanha (anúncio)' : 'Tags mais usadas'} hint={overview.data.series.byCampaign.length ? 'Qual anúncio está trazendo conversa' : 'Como a equipe está classificando'}>
              <ReportChart def={{ metric: 'conversations', groupBy: overview.data.series.byCampaign.length ? 'campaign' : 'tag', from: range[0], to: range[1], filters: {}, chart: 'bar' }} series={overview.data.series.byCampaign.length ? overview.data.series.byCampaign : overview.data.series.byTag} height={220} />
            </Card>
          </div>

          <Vendas overview={overview.data} range={range} vendas={vendas} onAuditar={(f) => setFoco({ ...f, seq: Date.now() })} />
          {vendas && <SalesDetails from={periodo.from} to={periodo.to} userId={filtros.agentId} tagIds={filtros.tagIds} companyId={filtros.companyId} />}
          <Attendances from={periodo.from} to={periodo.to} userId={filtros.agentId} focus={foco} companyId={filtros.companyId} />
        </>
      )}

      {/* ---------- Construtor ---------- */}
      <button onClick={() => setShowBuilder((v) => !v)} className="w-full flex items-center gap-2 rounded-2xl border border-dashed border-line bg-panel px-4 py-3 text-sm text-ink hover:bg-field">
        <SlidersHorizontal size={16} className="text-muted" />
        <span className="font-medium flex-1 text-left">Relatório personalizado</span>
        <span className="text-xs text-muted hidden sm:inline">escolha métrica, agrupamento, filtros; salve e exporte</span>
        {showBuilder ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
      </button>

      <div className={cn('grid gap-5 lg:grid-cols-[300px_1fr]', !showBuilder && 'hidden')}>
        {/* ---------- Construtor ---------- */}
        <aside className="space-y-4">
          <section className="rounded-2xl bg-panel border border-line p-4 space-y-4">
            <Field label="Medir">
              <select className={inputCls} value={def.metric} onChange={(e) => set('metric', e.target.value as ReportDefinition['metric'])}>
                {Object.entries(metricLabel).filter(([k]) => vendas || k !== 'revenue').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Agrupar por">
              <select className={inputCls} value={def.groupBy} onChange={(e) => set('groupBy', e.target.value as ReportDefinition['groupBy'])}>
                <optgroup label="Tempo">{TIME_GROUPS.map((k) => <option key={k} value={k}>{GROUP_LABEL[k as ReportDefinition['groupBy']]}</option>)}</optgroup>
                <optgroup label="Categoria">{Object.entries(GROUP_LABEL).filter(([k]) => !TIME_GROUPS.includes(k) && (k !== 'company' || (temEmpresas && empresa === 'all'))).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</optgroup>
              </select>
            </Field>
            <Field label="Período">
              <div className="flex flex-wrap gap-1 mb-2">
                {PRESETS.map((p) => (
                  <button key={p.label} type="button" onClick={() => { const [from, to] = p.range(); setDef((d) => ({ ...d, from, to })); }} className="text-[11px] font-semibold px-2 py-1 rounded-md border border-line text-muted hover:bg-field">{p.label}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" className={inputCls} value={def.from} onChange={(e) => set('from', e.target.value)} />
                <input type="date" className={inputCls} value={def.to} onChange={(e) => set('to', e.target.value)} />
              </div>
              <span className="text-[11px] text-faint">Data final não incluída.</span>
            </Field>
          </section>

          <section className="rounded-2xl bg-panel border border-line p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Filtros</h3>
            <Field label="Status">
              <select className={inputCls} value={def.filters.status ?? ''} onChange={(e) => setFilter('status', (e.target.value || undefined) as ReportDefinition['filters']['status'])}>
                <option value="">Todos</option><option value="waiting">Aguardando</option><option value="in_progress">Em atendimento</option><option value="closed">Encerrado</option>
              </select>
            </Field>
            <Field label="Número">
              <select className={inputCls} value={def.filters.numberId ?? ''} onChange={(e) => setFilter('numberId', e.target.value || undefined)}>
                <option value="">Todos</option>{numbers.data?.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
            </Field>
            <Field label="Origem">
              <select className={inputCls} value={def.filters.origin ?? ''} onChange={(e) => setFilter('origin', (e.target.value || undefined) as ReportDefinition['filters']['origin'])}>
                <option value="">Todas</option><option value="ad">Anúncio</option><option value="post">Publicação</option><option value="link">Link</option><option value="organic">Orgânico</option>
              </select>
            </Field>
            <Field label="Tags"><TagPicker field tags={tags.data ?? []} value={def.filters.tagIds ?? []} onChange={(ids) => setFilter('tagIds', ids.length ? ids : undefined)} placeholder="Qualquer tag" /></Field>
            <Field label="Consultor">
              <select className={inputCls} value={def.filters.agentId ?? ''} onChange={(e) => setFilter('agentId', e.target.value || undefined)}>
                <option value="">Todos</option>{agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isActive ? '' : ' (inativo)'}</option>)}
              </select>
            </Field>
          </section>

          <Button className="w-full" icon={<Play size={15} />} loading={run.isPending} loadingText="Calculando…" onClick={() => execute()}>Gerar relatório</Button>
        </aside>

        {/* ---------- Resultado ---------- */}
        <div className="space-y-4 min-w-0">
          <section className="rounded-2xl bg-panel border border-line">
            <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-line">
              <div className="min-w-[200px] flex-1">
                <div className="font-display font-semibold text-ink">
                  {result ? `${metricLabel[result.definition.metric]} por ${GROUP_LABEL[result.definition.groupBy].toLowerCase()}` : 'Relatório'}
                </div>
                {result && (
                  <div className="text-xs text-muted tnum">
                    {new Date(result.definition.from).toLocaleDateString('pt-BR')} → {new Date(result.definition.to).toLocaleDateString('pt-BR')} · {isAvg ? `média ${(total / Math.max(1, result.series.length)).toFixed(1)} min` : isRate ? 'taxa por grupo' : `total ${isBRL ? fmtBRL(total) : total.toLocaleString('pt-BR')}`}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-field p-0.5 ml-auto">
                {([['bar', BarChart3], ['line', LineIcon], ['pie', PieIcon]] as const).map(([c, Icon]) => (
                  <button key={c} title={c} onClick={() => { set('chart', c); if (result) setResult({ ...result, definition: { ...result.definition, chart: c } }); }} className={cn('p-1.5 rounded-md', (result?.definition.chart ?? def.chart) === c ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink')}><Icon size={15} /></button>
                ))}
                <span className="w-px h-4 bg-line mx-0.5" />
                <button title="Tabela" onClick={() => setView(view === 'table' ? 'chart' : 'table')} className={cn('p-1.5 rounded-md', view === 'table' ? 'bg-panel shadow-sm text-ink' : 'text-muted hover:text-ink')}><Table2 size={15} /></button>
              </div>
              <Button size="sm" variant="ghost" icon={<Download size={13} />} onClick={exportCsv} disabled={!result}>CSV</Button>
              <Button size="sm" variant="ghost" icon={<Save size={13} />} onClick={() => setSaving(true)} disabled={!result}>Salvar</Button>
            </div>
            <div className="p-4">
              {!result && <div className="h-72 grid place-items-center text-sm text-muted">{run.isPending ? 'Calculando…' : 'Configure e clique em Gerar relatório.'}</div>}
              {result && view === 'chart' && <ReportChart def={result.definition} series={result.series} />}
              {result && view === 'table' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="py-2 pr-4">{GROUP_LABEL[result.definition.groupBy]}</th><th className="py-2 text-right">{metricLabel[result.definition.metric]}</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {result.series.map((s) => <tr key={s.label}><td className="py-2 pr-4 text-ink">{fmtLabel(result.definition.groupBy, s.label)}</td><td className="py-2 text-right tnum font-mono text-ink">{fmtCelula(s.value)}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* Salvos */}
          <section className="rounded-2xl bg-panel border border-line p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5"><Bookmark size={13} /> Relatórios salvos</h3>
            {saved.data?.length === 0 && <p className="text-sm text-muted">Nenhum ainda. Gere um relatório e clique em Salvar para reabrir com um clique.</p>}
            <div className="flex flex-wrap gap-2">
              {saved.data?.map((r) => (
                <div key={r.id} className="group inline-flex items-center gap-1 rounded-lg border border-line bg-field pl-3 pr-1 py-1 text-sm">
                  <button onClick={() => { setDef(r.definition); execute(r.definition); }} className="font-medium text-ink hover:text-accent-ink">{r.name}</button>
                  <button onClick={() => setDeleting(r)} className="p-1 text-faint hover:text-danger opacity-0 group-hover:opacity-100" title="Excluir"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <SaveModal open={saving} onClose={() => setSaving(false)} pending={save.isPending} onSubmit={(name) => save.mutateAsync({ name, definition: result?.definition ?? def }).then(() => { toast.ok('Relatório salvo'); setSaving(false); }).catch(toast.err)} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Excluir relatório salvo" danger confirmLabel="Excluir" text={`"${deleting?.name}" será removido da lista.`} onConfirm={async () => { if (!deleting) return; try { await remove.mutateAsync(deleting.id); toast.ok('Excluído'); } catch (err) { toast.err(err); throw err; } }} />
    </PageShell>
  );
}

/**
 * Vendas do período, da tabela `sales` (encerramentos "Comprou" com valor). Taxa de conversão
 * vem do histórico de encerramentos: comprou ÷ (comprou + não comprou) — "sem resultado" (fechado
 * pelo sistema, ou anterior à regra que obriga o resultado) fica de fora.
 */
/** origem da venda (`sales`): orçamento pago no Asaas, orçamento marcado como pago, ou digitada no encerramento */
const ORIGEM_VENDA = { asaas: 'Pix automático (Asaas)', manual: 'Orçamento pago por fora', close: 'Informada no encerramento' } as const;

function Vendas({ overview, range, vendas, onAuditar }: { overview: NonNullable<ReturnType<typeof useReportOverview>['data']>; range: [string, string]; vendas: boolean; onAuditar: (f: Omit<AttendanceFocus, 'seq'>) => void }) {
  const v = overview.sales;
  const { won, lost, winRate } = overview.kpis;
  const labels = useOutcomeLabels();
  return (
    <section className="space-y-3">
      <h2 className="font-display font-semibold text-ink">{vendas ? 'Vendas' : 'Resultados'}</h2>
      {/* sem venda: só o resultado do encerramento (conversão e motivos), nada de faturamento */}
      {!vendas && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi icon={<CheckCircle2 size={15} />} label={labels.won} value={won.toLocaleString('pt-BR')} sub="encerrados com esse resultado" />
          <Kpi icon={<Target size={15} />} label={labels.lost} value={lost.toLocaleString('pt-BR')} sub="encerrados com esse resultado" />
          <Kpi icon={<Target size={15} />} label={`Taxa de “${labels.won}”`} value={winRate != null ? `${Math.round(winRate * 100)}%` : '—'} sub={`${labels.won.toLowerCase()} ÷ (${labels.won.toLowerCase()} + ${labels.lost.toLowerCase()})`} />
        </div>
      )}
      {vendas && <div className="grid gap-3 sm:grid-cols-3">
        <Kpi icon={<DollarSign size={15} />} label="Faturado no período" value={fmtBRL(v.total)} sub={`${v.count} venda${v.count === 1 ? '' : 's'}`} />
        <Kpi icon={<Receipt size={15} />} label="Ticket médio" value={v.avgTicket != null ? fmtBRL(v.avgTicket) : '—'} sub="faturado ÷ vendas" />
        <Kpi icon={<Target size={15} />} label="Taxa de conversão" value={winRate != null ? `${Math.round(winRate * 100)}%` : '—'} sub={`${won} ${labels.won.toLowerCase()} · ${lost} ${labels.lost.toLowerCase()}`} />
      </div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {vendas && <>
        <Card title="Faturamento por dia" hint="Pelo dia do fechamento da venda">
          <ReportChart def={{ metric: 'revenue', groupBy: 'day', from: range[0], to: range[1], filters: {}, chart: 'line' }} series={v.byDay} height={220} />
        </Card>
        <Card title="Vendas por atendente" hint={`Faturado por quem encerrou como ${labels.won}`}>
          <ReportChart def={{ metric: 'revenue', groupBy: 'agent', from: range[0], to: range[1], filters: {}, chart: 'bar' }} series={v.byAgent} height={220} />
          {v.byAgent.length > 0 && (
            <table className="w-full mt-3 text-[12.5px]">
              <thead><tr className="text-left text-muted border-b border-line"><th className="py-1.5 font-medium">Atendente</th><th className="py-1.5 font-medium text-right">Vendas</th><th className="py-1.5 font-medium text-right">Faturado</th><th className="py-1.5 font-medium text-right">Ticket médio</th></tr></thead>
              <tbody>
                {v.byAgent.map((a) => (
                  <tr key={a.label} className="border-b border-line last:border-0">
                    <td className="py-1.5 text-ink truncate max-w-[160px]">{a.label}</td>
                    <td className="py-1.5 text-right tnum">{a.count}</td>
                    <td className="py-1.5 text-right tnum">{fmtBRL(a.value)}</td>
                    <td className="py-1.5 text-right tnum text-muted">{fmtBRL(a.avgTicket)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Faturamento por origem" hint="De onde veio o dinheiro do período">
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-left text-muted border-b border-line"><th className="py-1.5 font-medium">Origem</th><th className="py-1.5 font-medium text-right">Vendas</th><th className="py-1.5 font-medium text-right">Faturado</th><th className="py-1.5 font-medium text-right">%</th></tr></thead>
            <tbody>
              {v.bySource.map((o) => (
                <tr key={o.source} className="border-b border-line last:border-0">
                  <td className="py-1.5 text-ink">{ORIGEM_VENDA[o.source]}</td>
                  <td className="py-1.5 text-right tnum">{o.count}</td>
                  <td className="py-1.5 text-right tnum">{fmtBRL(o.value)}</td>
                  <td className="py-1.5 text-right tnum text-muted">{v.total ? `${Math.round((o.value / v.total) * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={cn('mt-3 rounded-lg px-3 py-2 text-[12.5px]', v.refunds.count ? 'bg-danger-soft text-danger-ink' : 'bg-field text-muted')}>
            Estornos no período: <b className="tnum">{v.refunds.count}</b> · <b className="tnum">{fmtBRL(v.refunds.value)}</b> — já fora do faturado.
          </p>
        </Card>
        </>}
        <Card title={`${labels.lost}, por motivo`} hint='Onde o negócio escapa. Clique num motivo para ver os atendimentos'>
          {overview.lostReasons.length ? (
            <>
              <ReportChart def={{ metric: 'lost', groupBy: 'reason', from: range[0], to: range[1], filters: {}, chart: 'bar' }} series={overview.lostReasons} height={220} />
              {/* auditar: do número ao atendimento — lista de "Não comprou" daquela tag, mais abaixo */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {overview.lostReasons.map((r) => {
                  const auditavel = !!r.closeReasonId || r.label !== '(sem motivo)';
                  return (
                    <button key={`${r.closeReasonId ?? ''}-${r.label}`} type="button" disabled={!auditavel} onClick={() => onAuditar({ outcome: 'lost', ...(r.closeReasonId ? { closeReasonId: r.closeReasonId } : { reason: r.label }), label: r.label })} title={auditavel ? 'Ver esses atendimentos' : undefined} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[12px] text-ink hover:bg-field disabled:opacity-50 disabled:cursor-default">
                      {r.color && <span className="w-2 h-2 rounded-full" style={{ background: r.color }} />}{r.label} <b className="tnum">{r.value}</b>
                    </button>
                  );
                })}
              </div>
            </>
          ) : <p className="py-10 text-center text-[13px] text-muted">Nenhum “{labels.lost}” no período.</p>}
        </Card>
      </div>
    </section>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-2xl bg-panel border border-line p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted">{icon}{label}</div>
      <div className={cn('text-2xl font-semibold tnum mt-1', tone === 'warn' ? 'text-warn' : 'text-ink')}>{value}</div>
      {sub && <div className="text-[11px] text-faint mt-0.5">{sub}</div>}
    </div>
  );
}
function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-panel border border-line p-4">
      <div className="mb-1"><h3 className="font-display font-semibold text-ink text-sm">{title}</h3>{hint && <p className="text-[11px] text-muted">{hint}</p>}</div>
      {children}
    </section>
  );
}
const fmtMin = (m: number) => (m < 60 ? `${m.toFixed(0)} min` : `${(m / 60).toFixed(1)} h`);

/** Indicadores principais por empresa, lado a lado. Clicar numa empresa abre a tela só dela. */
function PorEmpresa({ rows, onAbrir, vendas }: { rows: CompanyReportRow[]; onAbrir: (id: string) => void; vendas: boolean }) {
  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  const labels = useOutcomeLabels();
  return (
    <section className="rounded-2xl bg-panel border border-line p-4">
      <div className="mb-2">
        <h3 className="font-display font-semibold text-ink text-sm flex items-center gap-1.5"><Building2 size={14} className="text-accent" /> Por empresa</h3>
        <p className="text-[11px] text-muted">Mesmo período e filtros. Clique numa empresa para ver a tela só dela. Empresa removida aparece com o histórico dos números que ela teve.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2 pr-4">Empresa</th>
              <th className="py-2 pr-4 text-right">Atendimentos</th>
              <th className="py-2 pr-4 text-right">Encerrados</th>
              <th className="py-2 pr-4 text-right">Na fila</th>
              <th className="py-2 pr-4 text-right">1ª resposta</th>
              <th className="py-2 pr-4 text-right">{vendas ? 'Vendas' : labels.won}</th>
              {vendas && <th className="py-2 pr-4 text-right">Faturamento</th>}
              {vendas && <th className="py-2 pr-4 text-right">Ticket médio</th>}
              <th className="py-2 text-right">{vendas ? 'Conversão' : `Taxa de “${labels.won}”`}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.companyId ?? 'sem'} className="border-t border-line">
                <td className="py-2 pr-4">
                  {r.companyId
                    ? <button type="button" onClick={() => onAbrir(r.companyId!)} className={cn('font-medium hover:underline text-left', r.removed ? 'text-muted' : 'text-accent')}>{r.name}</button>
                    : <span className="text-muted">{r.name}</span>}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{r.conversations.toLocaleString('pt-BR')}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{r.closed.toLocaleString('pt-BR')}</td>
                <td className={cn('py-2 pr-4 text-right tabular-nums', r.waitingNow > 5 && 'text-warn-ink font-semibold')}>{r.waitingNow}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{r.avgFirstResponseMin != null ? fmtMin(r.avgFirstResponseMin) : '—'}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{r.won.toLocaleString('pt-BR')}</td>
                {vendas && <td className="py-2 pr-4 text-right tabular-nums">{fmtBRL(r.revenue)}</td>}
                {vendas && <td className="py-2 pr-4 text-right tabular-nums">{r.avgTicket != null ? fmtBRL(r.avgTicket) : '—'}</td>}
                <td className="py-2 text-right tabular-nums">{pct(r.winRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SaveModal({ open, onClose, onSubmit, pending }: { open: boolean; onClose: () => void; onSubmit: (name: string) => void; pending: boolean }) {
  const [name, setName] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Salvar relatório" width="max-w-sm">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(name); }} className="space-y-4">
        <Field label="Nome" hint="Ex.: Leads por campanha — mês"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={pending} loadingText="Salvando…">Salvar</Button></div>
      </form>
    </Modal>
  );
}
