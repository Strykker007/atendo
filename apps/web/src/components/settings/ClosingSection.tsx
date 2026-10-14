'use client';
import { useState } from 'react';
import { CheckCircle2, EyeOff, GripVertical, Plus, Tag, Trash2, XCircle } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { ColorPopover, PALETTE } from '@/components/ui/ColorSwatches';
import {
  useTenantSettings, useUpdateTenantSettings, useCloseReasons, useCreateCloseReason, useUpdateCloseReason, useDeleteCloseReason, useReorderCloseReasons,
  useCan, useInternalCloseAudit, useOutcomeLabels, OUTCOME_LABELS_DEFAULT, type CloseReason, type CloseReasonOutcome,
} from '@/lib/hooks';

/**
 * Regras do encerramento de atendimento: o nome dos dois resultados e exigir o valor em "Comprou".
 * Ligado (padrão), toda venda soma faturamento e ticket médio. Desligado serve a quem não sabe o
 * valor na hora (orçamento fechado depois, venda no balcão) — o "Comprou" conta na conversão,
 * mas não vira venda no relatório.
 */
export function ClosingSection() {
  const settings = useTenantSettings();
  const update = useUpdateTenantSettings();
  const labels = useOutcomeLabels();
  if (!settings.data) return null;
  const d = settings.data;
  // cada regra é independente: valor em "Comprou", motivo em "Comprou", motivo em "Não comprou"
  const alternar = (campo: 'requireSaleValue' | 'requireReasonOnWon' | 'requireReasonOnLost', nome: string) => {
    const novo = !d[campo];
    update.mutateAsync({ [campo]: novo }).then(() => toast.ok(`${nome} agora é ${novo ? 'obrigatório' : 'opcional'}`)).catch(toast.err);
  };
  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink flex items-center gap-1.5"><CheckCircle2 size={16} className="text-ok" /> Encerramento</h2>
        <p className="text-sm text-muted">Como o atendente fecha um atendimento. As tags de cada resultado ficam em Tags.</p>
      </div>
      <OutcomeLabelsFields />
      <div className="space-y-2.5">
        <Regra on={d.requireSaleValue} disabled={update.isPending} onToggle={() => alternar('requireSaleValue', `Valor em “${labels.won}”`)}
          titulo={`Exigir valor ao encerrar como “${labels.won}”`}
          desc={d.requireSaleValue ? 'Ligado: sem valor, não encerra. Toda venda soma faturamento e ticket médio. Orçamento pago no atendimento já conta como valor.' : 'Desligado: dá para encerrar sem valor. Conta na taxa de conversão, mas não soma no faturamento.'} />
        <Regra on={d.requireReasonOnWon} disabled={update.isPending} onToggle={() => alternar('requireReasonOnWon', `Motivo em “${labels.won}”`)}
          titulo={`Exigir motivo ao encerrar como “${labels.won}”`}
          desc={d.requireReasonOnWon ? `Ligado: com motivo cadastrado para “${labels.won}”, o atendente escolhe um para encerrar.` : 'Desligado: o motivo aparece, mas é opcional.'} />
        <Regra on={d.requireReasonOnLost} disabled={update.isPending} onToggle={() => alternar('requireReasonOnLost', `Motivo em “${labels.lost}”`)}
          titulo={`Exigir motivo ao encerrar como “${labels.lost}”`}
          desc={d.requireReasonOnLost ? `Ligado: com motivo cadastrado para “${labels.lost}”, o atendente escolhe um para encerrar.` : 'Desligado: o motivo aparece, mas é opcional.'} />
      </div>
      <ReasonsList />
      <InternalCloseAudit />
    </section>
  );
}

function Regra({ on, disabled, onToggle, titulo, desc }: { on: boolean; disabled?: boolean; onToggle: () => void; titulo: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <button type="button" role="switch" aria-checked={on} aria-label={titulo} disabled={disabled} onClick={onToggle}
        className={`relative mt-0.5 w-9 h-5 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-accent' : 'bg-line'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <div className="text-sm">
        <div className="font-medium text-ink">{titulo}</div>
        <p className="text-xs text-muted">{desc}</p>
      </div>
    </div>
  );
}

/**
 * Nome dos dois resultados ("Fechou venda" / "Perdido", "Matriculado" / "Não matriculou"…). Só o
 * rótulo muda: o primeiro continua sendo a venda (valor, faturamento, conversão) e o segundo a
 * perda, nos relatórios, fluxos e filtros. Salva ao sair do campo; vazio volta ao padrão.
 */
function OutcomeLabelsFields() {
  const update = useUpdateTenantSettings();
  const labels = useOutcomeLabels();
  const salvar = (campo: 'wonLabel' | 'lostLabel', atual: string, el: HTMLInputElement) => {
    const v = el.value.trim();
    if (v === atual) return;
    update.mutateAsync({ [campo]: v }).then(() => toast.ok('Nome do resultado salvo')).catch((e) => { el.value = atual; toast.err(e); });
  };
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium text-ink">Nome dos resultados</div>
        <p className="text-xs text-muted">Como os botões aparecem no encerramento, nos filtros e nos relatórios. O primeiro conta como venda; o segundo, como perda.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {([['wonLabel', 'won', 'text-ok', CheckCircle2], ['lostLabel', 'lost', 'text-danger', XCircle]] as const).map(([campo, o, cls, Icon]) => (
          <label key={campo} className="flex items-center gap-2">
            <Icon size={15} className={cn('shrink-0', cls)} />
            {/* key: recria o campo quando o nome salvo muda (outra aba, valor padrão de volta) */}
            <input key={labels[o]} className={cn(inputCls, 'flex-1 min-w-0')} defaultValue={labels[o]} maxLength={30} placeholder={OUTCOME_LABELS_DEFAULT[o]}
              aria-label={o === 'won' ? 'Nome do resultado de venda' : 'Nome do resultado de perda'} onBlur={(e) => salvar(campo, labels[o], e.currentTarget)} />
          </label>
        ))}
      </div>
    </div>
  );
}

/** "Interno" não é um resultado: é o motivo `ignoreInReports`, que só aparece no encerramento interno */
type ReasonKind = CloseReasonOutcome | 'internal';
const REASON_KINDS: ReasonKind[] = ['lost', 'won', 'both', 'internal'];
const kindLabel = (k: ReasonKind, labels: { won: string; lost: string }) => (k === 'won' || k === 'lost' ? labels[k] : k === 'both' ? 'Os dois' : 'Interno (fora dos relatórios)');
const kindOf = (r: CloseReason): ReasonKind => (r.ignoreInReports ? 'internal' : r.outcome);
const kindPatch = (k: ReasonKind) => (k === 'internal' ? { ignoreInReports: true } : { outcome: k, ignoreInReports: false });

/**
 * Motivos de encerramento: a lista que o atendente escolhe ao encerrar (obrigatório quando há
 * motivo para o resultado). Cada um vale para Comprou, Não comprou ou os dois. Arraste para
 * ordenar; excluir desativa — o histórico e os relatórios continuam com o nome.
 * "Interno" = motivo de atendimento interno (diretoria, teste): só quem tem
 * `conversations.close_internal` vê, e o atendimento sai dos relatórios. "Exige tag" recusa o
 * encerramento sem nenhuma tag no atendimento.
 */
function ReasonsList() {
  const reasons = useCloseReasons();
  const create = useCreateCloseReason();
  const update = useUpdateCloseReason();
  const remove = useDeleteCloseReason();
  const reorder = useReorderCloseReasons();
  const labels = useOutcomeLabels();
  const [nome, setNome] = useState('');
  const [outcome, setOutcome] = useState<ReasonKind>('lost');
  const [corDe, setCorDe] = useState<string | null>(null);
  const ativos = (reasons.data ?? []).filter((r) => r.isActive);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    try {
      await create.mutateAsync({ name: nome.trim(), ...kindPatch(outcome), color: PALETTE[ativos.length % PALETTE.length] });
      setNome('');
    } catch (err) { toast.err(err); }
  }
  function onDragEnd(r: DropResult) {
    if (!r.destination || r.destination.index === r.source.index) return;
    const ids = ativos.map((x) => x.id);
    const [m] = ids.splice(r.source.index, 1);
    ids.splice(r.destination.index, 0, m);
    reorder.mutate(ids, { onError: toast.err });
  }
  const salvar = (r: CloseReason, patch: Partial<Pick<CloseReason, 'color' | 'outcome' | 'name' | 'ignoreInReports' | 'requiresTag'>>) => update.mutateAsync({ id: r.id, ...patch }).catch(toast.err);

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div>
        <div className="text-sm font-medium text-ink">Motivos de encerramento</div>
        <p className="text-xs text-muted">O atendente escolhe um ao encerrar — obrigatório quando há motivo para o resultado e a regra acima está ligada. Aparece no topo da conversa, na aba Encerrado, vira filtro nas conversas e entra nos relatórios.</p>
      </div>
      {ativos.length > 0 && (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="motivos">
            {(drop) => (
              <ul ref={drop.innerRef} {...drop.droppableProps} className="rounded-xl border border-line divide-y divide-line">
                {ativos.map((r, i) => (
                  <Draggable key={r.id} draggableId={r.id} index={i}>
                    {(drag, snap) => (
                      <li ref={drag.innerRef} {...drag.draggableProps} className={cn('flex items-center gap-2 px-3 py-1.5 bg-panel text-sm', snap.isDragging && 'shadow-lg rounded-lg ring-1 ring-line')}>
                        <span {...drag.dragHandleProps} className="text-faint hover:text-ink cursor-grab" title="Arraste para ordenar"><GripVertical size={14} /></span>
                        <div className="relative shrink-0">
                          <button type="button" onClick={() => setCorDe(corDe === r.id ? null : r.id)} aria-label={`Cor de ${r.name}`} className="w-4 h-4 rounded-full block hover:ring-2 hover:ring-line" style={{ background: r.color }} />
                          {corDe === r.id && <ColorPopover value={r.color} onClose={() => setCorDe(null)} onPick={(c) => { setCorDe(null); void salvar(r, { color: c }); }} />}
                        </div>
                        <input className="flex-1 min-w-0 bg-transparent text-ink focus:outline-none focus:ring-1 focus:ring-accent/40 rounded px-1" defaultValue={r.name} maxLength={80} aria-label="Nome do motivo"
                          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.name) void salvar(r, { name: v }); else e.target.value = r.name; }} />
                        {r.ignoreInReports && <EyeOff size={13} className="text-warn shrink-0" aria-label="Fora dos relatórios" />}
                        <button type="button" aria-pressed={r.requiresTag} title={r.requiresTag ? 'Exige tag no atendimento (clique para dispensar)' : 'Não exige tag (clique para exigir)'} onClick={() => void salvar(r, { requiresTag: !r.requiresTag })}
                          className={cn('inline-flex items-center gap-1 rounded px-1.5 h-7 text-[11.5px] shrink-0', r.requiresTag ? 'text-accent bg-accent-soft font-medium' : 'text-faint hover:text-ink')}>
                          <Tag size={12} /> {r.requiresTag ? 'Exige tag' : 'Tag'}
                        </button>
                        <select className={cn(inputCls, 'h-7 py-0 w-auto text-[12px]')} value={kindOf(r)} onChange={(e) => void salvar(r, kindPatch(e.target.value as ReasonKind))} aria-label={`Em qual resultado ${r.name} aparece`}>
                          {REASON_KINDS.map((o) => <option key={o} value={o}>{kindLabel(o, labels)}</option>)}
                        </select>
                        <button type="button" title="Excluir (o histórico continua com o nome)" onClick={() => remove.mutateAsync(r.id).catch(toast.err)} className="text-faint hover:text-danger p-1"><Trash2 size={14} /></button>
                      </li>
                    )}
                  </Draggable>
                ))}
                {drop.placeholder}
              </ul>
            )}
          </Droppable>
        </DragDropContext>
      )}
      {reasons.data && ativos.length === 0 && <p className="text-xs text-faint">Nenhum motivo — o encerramento não pede motivo.</p>}
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <input className={cn(inputCls, 'flex-1 min-w-[12rem]')} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder="Ex.: Achou caro" aria-label="Novo motivo" />
        <select className={cn(inputCls, 'w-auto')} value={outcome} onChange={(e) => setOutcome(e.target.value as ReasonKind)} aria-label="Resultado do novo motivo">
          {REASON_KINDS.map((o) => <option key={o} value={o}>{kindLabel(o, labels)}</option>)}
        </select>
        <Button type="submit" size="sm" icon={<Plus size={14} />} loading={create.isPending}>Adicionar</Button>
      </form>
    </div>
  );
}

/**
 * Auditoria dos encerramentos internos: quem, quando, qual contato e o motivo. Só com
 * `profiles.manage` (por padrão o Administrador) — a mesma regra da API (`GET /audit-logs`).
 */
function InternalCloseAudit() {
  const pode = useCan('profiles.manage');
  const [page, setPage] = useState(1);
  const audit = useInternalCloseAudit(pode, page);
  if (!pode) return null;
  const d = audit.data;
  const paginas = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div>
        <div className="text-sm font-medium text-ink flex items-center gap-1.5"><EyeOff size={14} className="text-warn" /> Encerramentos internos (auditoria)</div>
        <p className="text-xs text-muted">Atendimentos encerrados como internos não entram nos relatórios. Confira aqui quem usou e quando — o registro não pode ser alterado.</p>
      </div>
      {d && d.rows.length === 0 && <p className="text-xs text-faint">Nenhum encerramento interno até agora.</p>}
      {d && d.rows.length > 0 && (
        <ul className="rounded-xl border border-line divide-y divide-line text-[12.5px]">
          {d.rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5">
              <span className="text-muted tnum">{new Date(r.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              <span className="text-ink font-medium">{r.actorName ?? '(sistema)'}</span>
              <span className="text-muted">encerrou</span>
              <span className="text-ink truncate max-w-[14rem]">{r.contactName ?? '(contato excluído)'}</span>
              {r.data?.reason && <span className="text-muted">· {r.data.reason}</span>}
              {r.data?.bulk && <span className="text-faint">· em massa</span>}
            </li>
          ))}
        </ul>
      )}
      {d && paginas > 1 && (
        <div className="flex items-center justify-end gap-2 text-[12px]">
          <Button type="button" size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
          <span className="text-muted">{page} / {paginas}</span>
          <Button type="button" size="sm" variant="ghost" disabled={page >= paginas} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
        </div>
      )}
    </div>
  );
}
