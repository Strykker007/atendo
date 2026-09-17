'use client';
import { useEffect, useMemo, useState } from 'react';
import { Play, Save, Download, BarChart3, LineChart as LineIcon, PieChart as PieIcon, Bookmark, Trash2, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/ui/Page';
import { Button } from '@/components/ui/Button';
import { Modal, Field, inputCls } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/Confirm';
import { TagPicker } from '@/components/chat/TagPicker';
import { ReportChart, METRIC_LABEL, GROUP_LABEL, fmtLabel } from '@/components/reports/ReportChart';
import { useNumbers, useTags, useRunReport, useSavedReports, useSaveReport, useDeleteSavedReport, type ReportDefinition, type ReportResult, type SavedReport } from '@/lib/hooks';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: '7 dias', range: () => [iso(addDays(new Date(), -6)), iso(addDays(new Date(), 1))] },
  { label: '30 dias', range: () => [iso(addDays(new Date(), -29)), iso(addDays(new Date(), 1))] },
  { label: 'Este mês', range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(new Date(n.getFullYear(), n.getMonth() + 1, 1))]; } },
  { label: 'Mês passado', range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 1))]; } },
];
const DEFAULT: ReportDefinition = { metric: 'conversations', groupBy: 'day', from: PRESETS[1].range()[0], to: PRESETS[1].range()[1], filters: {}, chart: 'line' };
const TIME_GROUPS = ['day', 'week', 'month'];

export default function RelatoriosPage() {
  const [def, setDef] = useState<ReportDefinition>(DEFAULT);
  const [result, setResult] = useState<ReportResult | null>(null);
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
      setResult(await run.mutateAsync(d));
    } catch (err) {
      toast.err(err);
    }
  }
  useEffect(() => { execute(DEFAULT); /* primeira carga */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // agrupamento por tempo → linha; por categoria → barra (o usuário pode trocar depois no resultado)
  useEffect(() => {
    setDef((d) => ({ ...d, chart: TIME_GROUPS.includes(d.groupBy) ? 'line' : 'bar' }));
  }, [def.groupBy]);

  const total = useMemo(() => result?.series.reduce((a, s) => a + s.value, 0) ?? 0, [result]);
  const isAvg = result?.definition.metric === 'avg_first_response_min';

  function exportCsv() {
    if (!result) return;
    const rows = [[GROUP_LABEL[result.definition.groupBy], METRIC_LABEL[result.definition.metric]], ...result.series.map((s) => [fmtLabel(result.definition.groupBy, s.label), String(s.value)])];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `atendo-${result.definition.metric}-por-${result.definition.groupBy}.csv`;
    a.click();
  }

  return (
    <PageShell width="max-w-6xl">
      <PageHeader title="Relatórios" subtitle="Escolha o que medir e como agrupar. Tudo sai das conversas, mensagens e tags reais." />

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* ---------- Construtor ---------- */}
        <aside className="space-y-4">
          <section className="rounded-2xl bg-panel border border-line p-4 space-y-4">
            <Field label="Medir">
              <select className={inputCls} value={def.metric} onChange={(e) => set('metric', e.target.value as ReportDefinition['metric'])}>
                {Object.entries(METRIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Agrupar por">
              <select className={inputCls} value={def.groupBy} onChange={(e) => set('groupBy', e.target.value as ReportDefinition['groupBy'])}>
                <optgroup label="Tempo">{TIME_GROUPS.map((k) => <option key={k} value={k}>{GROUP_LABEL[k as ReportDefinition['groupBy']]}</option>)}</optgroup>
                <optgroup label="Categoria">{Object.entries(GROUP_LABEL).filter(([k]) => !TIME_GROUPS.includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</optgroup>
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
              <select className={inputCls} value={def.filters.status ?? ''} onChange={(e) => setFilter('status', (e.target.value || undefined) as any)}>
                <option value="">Todos</option><option value="waiting">Aguardando</option><option value="in_progress">Em atendimento</option><option value="closed">Encerrado</option>
              </select>
            </Field>
            <Field label="Número">
              <select className={inputCls} value={def.filters.numberId ?? ''} onChange={(e) => setFilter('numberId', e.target.value || undefined)}>
                <option value="">Todos</option>{numbers.data?.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
            </Field>
            <Field label="Origem">
              <select className={inputCls} value={def.filters.origin ?? ''} onChange={(e) => setFilter('origin', (e.target.value || undefined) as any)}>
                <option value="">Todas</option><option value="ad">Anúncio</option><option value="post">Publicação</option><option value="link">Link</option><option value="organic">Orgânico</option>
              </select>
            </Field>
            <Field label="Tags"><TagPicker tags={tags.data ?? []} value={def.filters.tagIds ?? []} onChange={(ids) => setFilter('tagIds', ids.length ? ids : undefined)} placeholder="Qualquer tag" /></Field>
          </section>

          <Button className="w-full" icon={<Play size={15} />} loading={run.isPending} loadingText="Calculando…" onClick={() => execute()}>Gerar relatório</Button>
        </aside>

        {/* ---------- Resultado ---------- */}
        <div className="space-y-4 min-w-0">
          <section className="rounded-2xl bg-panel border border-line">
            <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-line">
              <div className="min-w-[200px] flex-1">
                <div className="font-display font-semibold text-ink">
                  {result ? `${METRIC_LABEL[result.definition.metric]} por ${GROUP_LABEL[result.definition.groupBy].toLowerCase()}` : 'Relatório'}
                </div>
                {result && (
                  <div className="text-xs text-muted tnum">
                    {new Date(result.definition.from).toLocaleDateString('pt-BR')} → {new Date(result.definition.to).toLocaleDateString('pt-BR')} · {isAvg ? `média ${(total / Math.max(1, result.series.length)).toFixed(1)} min` : `total ${total.toLocaleString('pt-BR')}`}
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
                    <thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="py-2 pr-4">{GROUP_LABEL[result.definition.groupBy]}</th><th className="py-2 text-right">{METRIC_LABEL[result.definition.metric]}</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {result.series.map((s) => <tr key={s.label}><td className="py-2 pr-4 text-ink">{fmtLabel(result.definition.groupBy, s.label)}</td><td className="py-2 text-right tnum font-mono text-ink">{isAvg ? s.value.toFixed(1) : s.value.toLocaleString('pt-BR')}</td></tr>)}
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
