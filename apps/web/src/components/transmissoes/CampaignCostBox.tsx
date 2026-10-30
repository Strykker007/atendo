'use client';
import { AlertTriangle, Ban, Loader2, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CampaignEstimate } from '@/lib/hooks';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v > 0 && v < 1 ? 4 : 2 });
const CATEGORIA: Record<string, string> = { marketing: 'marketing', utility: 'utilidade', authentication: 'autenticação' };

/**
 * Antes de disparar pela API oficial (docs/gasto-meta.md#transmissão): quanto a Meta vai
 * cobrar, o que trava o início e o que merece atenção. A Meta cobra o cliente direto.
 */
export function CampaignCostBox({ e, loading }: { e?: CampaignEstimate; loading?: boolean }) {
  if (!e) {
    return loading ? <p className="text-[12.5px] text-muted inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Calculando o custo…</p> : null;
  }
  if (e.provider !== 'meta') return null;
  return (
    <div className={cn('rounded-xl border p-3.5 space-y-2 text-[12.5px]', e.blockers.length ? 'border-danger/30 bg-danger-soft' : 'border-line bg-field')}>
      <div className="flex items-start gap-2">
        <Receipt size={15} className="text-muted mt-0.5 shrink-0" />
        <div className="flex-1 space-y-0.5">
          <p className="text-ink">
            Custo previsto na Meta: <b className="tnum text-[14px]">{brl(e.total)}</b>
          </p>
          <p className="text-muted">
            {e.recipients.toLocaleString('pt-BR')} mensagem(ns){e.category && <> de {CATEGORIA[e.category] ?? e.category}</>} × {brl(e.unitPrice)}
            {e.month && <> · mês com a Meta: {brl(e.month.spent)} → <b className="text-ink">{brl(e.month.after)}</b>{e.month.budget ? <> de {brl(e.month.budget)} de orçamento</> : null}</>}
          </p>
          <p className="text-[11px] text-faint">Estimativa pela tabela de preços. A Meta cobra direto no cartão da conta do WhatsApp; o valor real aparece em Plano e uso → Gasto com a Meta.</p>
        </div>
      </div>
      {e.blockers.map((b) => (
        <p key={b} className="flex items-start gap-1.5 text-danger-ink"><Ban size={13} className="shrink-0 mt-0.5" />{b}</p>
      ))}
      {e.warnings.map((w) => (
        <p key={w} className="flex items-start gap-1.5 text-warn-ink"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{w}</p>
      ))}
    </div>
  );
}
