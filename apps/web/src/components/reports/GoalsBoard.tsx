'use client';
import { useEffect, useMemo, useState } from 'react';
import { Copy, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Field, Modal, inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { useAgents, useCan, useGoalsProgress, useMonthGoals, useOutcomeLabels, useSaveGoals, type GoalRow, type GoalStatus, type GoalTarget, type MonthGoals } from '@/lib/hooks';

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const fmtPct = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const mesAtual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const mesAnterior = (m: string) => { const [y, mm] = m.split('-').map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`; };

const STATUS: Record<GoalStatus, { label: string; cls: string; bar: string }> = {
  done: { label: 'Meta batida', cls: 'bg-ok-soft text-ok', bar: 'bg-ok' },
  on_track: { label: 'No ritmo', cls: 'bg-accent-soft text-accent-ink', bar: 'bg-accent' },
  close: { label: 'Perto', cls: 'bg-warn-soft text-warn-ink', bar: 'bg-warn' },
  behind: { label: 'Atrás', cls: 'bg-danger-soft text-danger', bar: 'bg-danger' },
};

/**
 * Metas do mês (docs/metas.md): ranking por atingimento, com o quanto deveria ter vendido até hoje
 * no ritmo do mês e a projeção do fechamento. Quem tem `team.manage` define as metas.
 */
export function GoalsBoard() {
  const [month, setMonth] = useState(mesAtual());
  const labels = useOutcomeLabels();
  const q = useGoalsProgress(month);
  const podeEditar = useCan('team.manage');
  const [editando, setEditando] = useState(false);
  const d = q.data;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-panel border border-line p-3 flex flex-wrap items-end gap-3">
        <Field label="Mês">
          <input type="month" className={cn(inputCls, 'w-44')} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </Field>
        {d && (
          <div className="flex-1 min-w-[16rem]">
            <div className="flex justify-between text-[12px] text-muted mb-1">
              <span>Equipe: <b className="text-ink tnum">{fmtBRL(d.team.revenue)}</b>{d.team.revenueTarget ? <> de {fmtBRL(d.team.revenueTarget)} ({fmtPct(d.team.revenuePct)})</> : ' (sem meta de valor)'}</span>
              <span>{fmtPct(d.elapsedPct)} do mês</span>
            </div>
            <div className="relative h-2 rounded-full bg-field overflow-hidden">
              <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${Math.min(100, d.team.revenuePct ?? 0)}%` }} />
              {/* onde a equipe deveria estar hoje no ritmo linear */}
              <span className="absolute inset-y-0 w-0.5 bg-ink/60" style={{ left: `${Math.min(100, d.elapsedPct)}%` }} title="Esperado até hoje" />
            </div>
          </div>
        )}
        {podeEditar && <Button icon={<Target size={15} />} onClick={() => setEditando(true)}>Definir metas</Button>}
      </section>

      {q.isLoading && <SkeletonCards count={3} />}
      {d && d.ranking.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line bg-panel p-10 text-center text-sm text-muted">
          Nenhuma meta nem venda neste mês.{podeEditar && ' Clique em “Definir metas” para começar.'}
        </p>
      )}
      {d && d.ranking.length > 0 && (
        <section className="rounded-2xl bg-panel border border-line overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
              <tr>
                <th className="py-2.5 pl-4 pr-2 w-10">#</th>
                <th className="py-2.5 px-2">Consultor</th>
                <th className="py-2.5 px-2">Faturamento</th>
                <th className="py-2.5 px-2 text-right">{labels.won}</th>
                <th className="py-2.5 px-2 text-right">Atingido</th>
                <th className="py-2.5 px-2 text-right">Projeção</th>
                <th className="py-2.5 px-2 pr-4">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.ranking.map((r) => <Linha key={r.userId} r={r} elapsedPct={d.elapsedPct} />)}
            </tbody>
          </table>
        </section>
      )}
      <p className="text-[11px] text-faint">
        Realizado = vendas encerradas como “{labels.won}” pelo consultor no mês (mesma base do ranking). A marca na barra é onde ele deveria estar hoje no ritmo do mês; projeção = o ritmo atual levado até o fim do mês. Com meta de valor e de quantidade, o atingido é a média das duas e a situação é a pior.
      </p>

      {editando && <GoalsEditor month={month} onClose={() => setEditando(false)} />}
    </div>
  );
}

function Linha({ r, elapsedPct }: { r: GoalRow; elapsedPct: number }) {
  const st = r.status ? STATUS[r.status] : null;
  return (
    <tr className={cn('hover:bg-field/50', !r.isActive && 'opacity-60')}>
      <td className="py-2.5 pl-4 pr-2 tnum text-muted">{r.position ? `${r.position}º` : '—'}</td>
      <td className="py-2.5 px-2">
        <div className="text-ink font-medium">{r.name}</div>
        <div className="text-[11px] text-faint">{r.goalSource === 'own' ? 'meta própria' : r.goalSource === 'default' ? 'meta padrão' : 'sem meta'}</div>
      </td>
      <td className="py-2.5 px-2 min-w-[12rem]">
        <div className="flex justify-between text-[12px] tnum"><span className="text-ink">{fmtBRL(r.revenue)}</span>{r.revenueTarget != null && <span className="text-muted">de {fmtBRL(r.revenueTarget)}</span>}</div>
        {r.revenueTarget != null && (
          <div className="relative mt-1 h-1.5 rounded-full bg-field overflow-hidden">
            <span className={cn('absolute inset-y-0 left-0', st?.bar ?? 'bg-accent')} style={{ width: `${Math.min(100, r.revenuePct ?? 0)}%` }} />
            <span className="absolute inset-y-0 w-0.5 bg-ink/50" style={{ left: `${Math.min(100, elapsedPct)}%` }} />
          </div>
        )}
      </td>
      <td className="py-2.5 px-2 text-right tnum">{r.won}{r.wonTarget != null && <span className="text-muted">/{r.wonTarget}</span>}</td>
      <td className="py-2.5 px-2 text-right tnum font-semibold">{fmtPct(r.attainment)}</td>
      <td className="py-2.5 px-2 text-right tnum text-muted text-[12px]">
        {r.revenueProjection != null ? fmtBRL(r.revenueProjection) : r.wonProjection != null ? `${r.wonProjection} vendas` : '—'}
      </td>
      <td className="py-2.5 px-2 pr-4">{st ? <span className={cn('text-[11px] font-semibold rounded-full px-2 py-0.5', st.cls)}>{st.label}</span> : <span className="text-[11px] text-faint">—</span>}</td>
    </tr>
  );
}

type Rascunho = Record<string, GoalTarget>;
const deServidor = (g: MonthGoals | undefined): { padrao: GoalTarget; porUsuario: Rascunho } => ({
  padrao: g?.default ?? { revenueTarget: null, wonTarget: null },
  porUsuario: Object.fromEntries((g?.goals ?? []).map((x) => [x.userId, { revenueTarget: x.revenueTarget, wonTarget: x.wonTarget }])),
});

/** Metas do mês: padrão (vale para atendente sem meta própria) + meta de cada um. */
function GoalsEditor({ month, onClose }: { month: string; onClose: () => void }) {
  const agents = useAgents();
  const atual = useMonthGoals(month);
  const save = useSaveGoals();
  const [padrao, setPadrao] = useState<GoalTarget>({ revenueTarget: null, wonTarget: null });
  const [porUsuario, setPorUsuario] = useState<Rascunho>({});
  const [carregou, setCarregou] = useState(false);
  useEffect(() => {
    if (atual.data && !carregou) {
      const r = deServidor(atual.data);
      setPadrao(r.padrao);
      setPorUsuario(r.porUsuario);
      setCarregou(true);
    }
  }, [atual.data, carregou]);
  const pessoas = useMemo(() => (agents.data ?? []).filter((a) => a.isActive || porUsuario[a.id]).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [agents.data, porUsuario]);
  const mudar = (id: string, patch: Partial<GoalTarget>) => setPorUsuario((o) => ({ ...o, [id]: { ...(o[id] ?? { revenueTarget: null, wonTarget: null }), ...patch } }));

  async function copiarAnterior() {
    try {
      const r = deServidor(await api<MonthGoals>(`/sales-goals/${mesAnterior(month)}`));
      setPadrao(r.padrao);
      setPorUsuario(r.porUsuario);
      toast.ok('Metas do mês anterior copiadas — confira e salve');
    } catch (err) { toast.err(err); }
  }

  async function salvar() {
    try {
      await save.mutateAsync({
        month,
        default: padrao.revenueTarget || padrao.wonTarget ? padrao : null,
        goals: Object.entries(porUsuario).filter(([, g]) => g.revenueTarget || g.wonTarget).map(([userId, g]) => ({ userId, ...g })),
      });
      toast.ok('Metas salvas');
      onClose();
    } catch (err) { toast.err(err); }
  }

  const [y, m] = month.split('-');
  return (
    <Modal open onClose={onClose} title={`Metas de ${m}/${y}`} width="max-w-2xl">
      <div className="space-y-4">
        <div className="rounded-xl border border-line p-3 space-y-2">
          <div className="text-sm font-medium text-ink">Meta padrão <span className="text-[11px] font-normal text-muted">vale para todo atendente sem meta própria</span></div>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 text-[12.5px] text-muted">Faturamento <MoneyInput className="w-36" nullable value={padrao.revenueTarget} onChange={(v) => setPadrao((p) => ({ ...p, revenueTarget: v }))} aria-label="Meta padrão de faturamento" /></label>
            <label className="flex items-center gap-2 text-[12.5px] text-muted">Vendas <input type="number" min={0} className={cn(inputCls, 'w-24')} value={padrao.wonTarget ?? ''} onChange={(e) => setPadrao((p) => ({ ...p, wonTarget: e.target.value ? Math.max(0, Math.floor(Number(e.target.value))) : null }))} aria-label="Meta padrão de vendas" /></label>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-line divide-y divide-line">
          {pessoas.map((a) => {
            const g = porUsuario[a.id];
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="flex-1 min-w-[8rem] text-[13px] text-ink truncate">{a.name}{!a.isActive && <span className="ml-1 text-[11px] text-faint">(inativo)</span>}</span>
                <MoneyInput className="w-36" nullable value={g?.revenueTarget ?? null} onChange={(v) => mudar(a.id, { revenueTarget: v })} aria-label={`Meta de faturamento de ${a.name}`} />
                <input type="number" min={0} placeholder="vendas" className={cn(inputCls, 'w-24')} value={g?.wonTarget ?? ''} onChange={(e) => mudar(a.id, { wonTarget: e.target.value ? Math.max(0, Math.floor(Number(e.target.value))) : null })} aria-label={`Meta de vendas de ${a.name}`} />
              </div>
            );
          })}
          {pessoas.length === 0 && <p className="p-4 text-sm text-muted">Nenhum usuário ativo.</p>}
        </div>
        <p className="text-[11px] text-faint">Campo vazio = meta padrão (vale para quem tem papel de atendente).</p>

        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-3">
          <Button variant="ghost" icon={<Copy size={14} />} onClick={copiarAnterior}>Copiar do mês anterior</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={salvar} loading={save.isPending} disabled={!carregou}>Salvar metas</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
