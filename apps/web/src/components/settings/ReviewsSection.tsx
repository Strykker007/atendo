'use client';
import { ClipboardCheck } from 'lucide-react';
import { REVIEW_KINDS, REVIEW_KIND_HINT, REVIEW_KIND_LABEL, type ReviewKind, type ReviewKindRule, type ReviewSettings } from '@atendo/shared';
import { toast } from '@/components/ui/Toast';
import { inputCls } from '@/components/ui/Modal';
import { KindBadge } from '@/components/feedback/Feedback';
import { useReviewSettings, useSaveReviewSettings } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Regra } from './ClosingSection';

/**
 * Feedback de atendimento (docs/feedback-de-atendimento.md#configuração): por tipo, se exige ciência,
 * o prazo em horas ONLINE do atendente e se trava assumir novo atendimento. Vem com um padrão pronto
 * (Correção trava e tem 4h; Oportunidade e Orientação, 8h; Elogio só precisa ser visto).
 */
export function ReviewsSection() {
  const q = useReviewSettings();
  const save = useSaveReviewSettings();
  const s = q.data;
  if (!s) return null;
  const salvar = (v: ReviewSettings, msg = 'Feedback atualizado') => save.mutateAsync(v).then(() => toast.ok(msg)).catch(toast.err);
  const mudar = (k: ReviewKind, p: Partial<ReviewKindRule>) => salvar({ ...s, kinds: { ...s.kinds, [k]: { ...s.kinds[k], ...p } } });

  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-ink flex items-center gap-1.5"><ClipboardCheck size={16} className="text-accent" /> Feedback de atendimento</h2>
        <p className="text-sm text-muted">
          O gestor aponta correções, oportunidades, orientações e elogios na auditoria de atendimentos. O atendente é avisado na hora,
          de novo a cada entrada e no menu Feedbacks. O prazo conta só o tempo em que ele está <b>online</b> (painel aberto e dentro da escala):
          folga, fim de semana e ausência não consomem o prazo.
        </p>
      </div>
      <div className="divide-y divide-line rounded-xl border border-line">
        {REVIEW_KINDS.map((k) => {
          const r = s.kinds[k];
          return (
            <div key={k} className="p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <div className="sm:w-44 shrink-0">
                <KindBadge kind={k} />
                <p className="mt-1 text-[11.5px] text-muted">{REVIEW_KIND_HINT[k]}</p>
              </div>
              <label className="flex items-center gap-2 text-[12.5px] text-ink">
                <input type="checkbox" checked={r.requiresAck} disabled={save.isPending} onChange={(e) => mudar(k, e.target.checked ? { requiresAck: true, deadlineHours: r.deadlineHours ?? 8 } : { requiresAck: false, deadlineHours: null, blocksClaim: false })} />
                Exige “Li e estou ciente”
              </label>
              <label className={cn('flex items-center gap-2 text-[12.5px] text-ink', !r.requiresAck && 'opacity-40')}>
                Prazo
                <select disabled={!r.requiresAck || save.isPending} value={r.deadlineHours ?? ''} onChange={(e) => mudar(k, { deadlineHours: e.target.value ? Number(e.target.value) : null })}
                  className={cn(inputCls, 'w-auto py-1 text-[12.5px]')}>
                  <option value="">sem prazo</option>
                  {[1, 2, 4, 6, 8, 12, 16, 24, 40].map((h) => <option key={h} value={h}>{h}h online</option>)}
                </select>
              </label>
              <label className={cn('flex items-center gap-2 text-[12.5px] text-ink', !r.requiresAck && 'opacity-40')} title="Sem ciência, o atendente não assume novo atendimento (o que já é dele continua)">
                <input type="checkbox" checked={r.blocksClaim} disabled={!r.requiresAck || save.isPending} onChange={(e) => mudar(k, { blocksClaim: e.target.checked })} />
                Trava novo atendimento
              </label>
            </div>
          );
        })}
      </div>
      <Regra on={s.notifyReviewerOnOverdue} disabled={save.isPending}
        onToggle={() => salvar({ ...s, notifyReviewerOnOverdue: !s.notifyReviewerOnOverdue })}
        titulo="Avisar o gestor quando o prazo vencer"
        desc={`Quem fez o apontamento recebe um aviso quando o atendente passa o prazo online sem dar ciência. ${REVIEW_KINDS.map((k) => `${REVIEW_KIND_LABEL[k]}: ${s.kinds[k].requiresAck ? (s.kinds[k].deadlineHours ? `${s.kinds[k].deadlineHours}h` : 'sem prazo') : 'só ver'}`).join(' · ')}.`} />
    </section>
  );
}
