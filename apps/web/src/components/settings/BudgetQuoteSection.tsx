'use client';
import { Receipt } from 'lucide-react';
import { BUDGET_QUOTE_ITEMS, BUDGET_QUOTE_ITEMS_LABEL, type BudgetQuoteItems } from '@atendo/shared';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { useTenantSettings, useUpdateTenantSettings } from '@/lib/hooks';

/**
 * Orçamento por mensagem (docs/orcamentos.md#itens-sensíveis): quando os itens e valores vão no
 * texto do WhatsApp. Pensado para a migração à API oficial da Meta, que lê o conteúdo e é mais
 * rígida com remédio — aí a empresa pode passar para "Nunca".
 */
export function BudgetQuoteSection() {
  const settings = useTenantSettings();
  const update = useUpdateTenantSettings();
  if (!settings.data) return null;
  const atual = settings.data.budgetQuoteItems ?? 'link';
  const escolher = (v: BudgetQuoteItems) => {
    if (v === atual) return;
    if (v === 'always' && !confirm('Itens sensíveis (remédio, dosagem, controlado) passam a ir no texto do WhatsApp. Isso pode levar ao bloqueio do número. Continuar?')) return;
    update.mutateAsync({ budgetQuoteItems: v }).then(() => toast.ok('Orçamento por mensagem atualizado')).catch(toast.err);
  };
  return (
    <section className="rounded-2xl bg-panel border border-line p-5 space-y-3">
      <div>
        <h2 className="font-display font-semibold text-ink flex items-center gap-1.5"><Receipt size={16} className="text-accent" /> Orçamento por mensagem</h2>
        <p className="text-sm text-muted">No chat, “Enviar orçamento” manda o orçamento numerado para o cliente aprovar. Escolha quando os itens e valores vão no texto.</p>
      </div>
      <div className="space-y-2">
        {BUDGET_QUOTE_ITEMS.map((v) => (
          <label key={v} className={cn('flex items-start gap-2 rounded-xl border px-3 py-2.5 cursor-pointer', atual === v ? 'border-accent bg-accent-soft/40' : 'border-line')}>
            <input type="radio" name="budgetQuoteItems" className="mt-1" checked={atual === v} disabled={update.isPending} onChange={() => escolher(v)} />
            <span className="text-sm">
              <span className="font-medium text-ink">{BUDGET_QUOTE_ITEMS_LABEL[v].titulo}</span>
              <span className="block text-xs text-muted">{BUDGET_QUOTE_ITEMS_LABEL[v].desc}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
