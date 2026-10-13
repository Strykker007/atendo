'use client';
import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOutcomeLabels, type Conversation } from '@/lib/hooks';

const RESULTADO = {
  won: { icon: CheckCircle2, cls: 'text-ok' },
  lost: { icon: XCircle, cls: 'text-danger' },
  none: { icon: MinusCircle, cls: 'text-muted' },
} as const;

/** Etiqueta de um motivo, nas cores dele (mesmo visual do modal de encerrar). */
export function ReasonChip({ reason, small }: { reason: { name: string; color: string }; small?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border font-medium truncate max-w-full', small ? 'px-1.5 py-px text-[10.5px]' : 'px-2 py-0.5 text-[11.5px]')}
      style={{ color: reason.color, borderColor: `color-mix(in srgb, ${reason.color} 60%, transparent)`, background: `color-mix(in srgb, ${reason.color} 12%, transparent)` }} title={`Motivo: ${reason.name}`}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: reason.color }} />
      <span className="truncate">{reason.name}</span>
    </span>
  );
}

/** "Não comprou · Achou caro" — resultado + motivo do último encerramento, compacto. */
export function LastCloseInline({ conv, small }: { conv: Pick<Conversation, 'lastCloseOutcome' | 'lastCloseReason'>; small?: boolean }) {
  const labels = useOutcomeLabels();
  const o = conv.lastCloseOutcome ?? 'none';
  const r = RESULTADO[o];
  const Icon = r.icon;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className={cn('inline-flex items-center gap-1 shrink-0 font-medium', small ? 'text-[10.5px]' : 'text-[11.5px]', r.cls)}><Icon size={small ? 11 : 12} />{o === 'none' ? 'Encerrado' : labels[o]}</span>
      {conv.lastCloseReason && <ReasonChip reason={conv.lastCloseReason} small={small} />}
    </span>
  );
}

/**
 * Faixa no topo da conversa: como terminou o último atendimento. Fica mesmo depois de a conversa
 * reabrir — é o contexto de quem vai atender a pessoa de novo.
 */
export function LastCloseBar({ conv }: { conv: Conversation }) {
  if (!conv.lastClosedAt) return null;
  return (
    <div className="bg-panel border-b border-line px-3 py-1 flex items-center gap-2 min-w-0 text-[11.5px]">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-faint shrink-0" title="Como terminou o último atendimento desta conversa">Último encerramento</span>
      <span className="text-muted tnum shrink-0">{new Date(conv.lastClosedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
      <LastCloseInline conv={conv} />
    </div>
  );
}
