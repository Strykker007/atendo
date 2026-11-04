import { cents } from '@atendo/shared';

/**
 * Regras puras da comissão dos VogoPartners (docs/37-vogopartners.md) — sem banco, testáveis.
 */

export interface ActivationItemLike { value: number; kind: 'setup' | 'first_month' | 'other' }

/**
 * Quanto da cobrança de ativação PAGA é instalação e quanto é 1ª mensalidade. O desconto é
 * rateado entre todos os itens (o cliente pagou menos de tudo, não só de um item); "outros"
 * (treinamento, número extra…) não geram comissão.
 */
export function activationSplit(items: ActivationItemLike[], discount: number): { setupBase: number; firstMonthBase: number } {
  const gross = items.reduce((s, i) => s + (i.value > 0 ? i.value : 0), 0);
  if (gross <= 0) return { setupBase: 0, firstMonthBase: 0 };
  const factor = Math.max(0, gross - Math.max(0, discount)) / gross;
  const sum = (k: ActivationItemLike['kind']) => items.filter((i) => i.kind === k && i.value > 0).reduce((s, i) => s + i.value, 0);
  return { setupBase: cents(sum('setup') * factor), firstMonthBase: cents(sum('first_month') * factor) };
}

/** Pagamento conta para o parceiro só a partir do vínculo (cliente que já pagava antes não gera comissão retroativa). */
export const countsForPartner = (paidAt: Date, attributedAt: Date | null) => !!attributedAt && paidAt.getTime() >= attributedAt.getTime();

/** Fonte de comissão na tabela `finance_entries` (recebido por fora): categoria → tipo. */
export const FINANCE_CATEGORY_KIND: Record<string, 'recurring' | 'setup'> = { mensalidade: 'recurring', instalacao: 'setup' };

/** Referência da transferência no Asaas: amarra o Pix ao pagamento do parceiro (e a validação de saque). */
export const PAYOUT_REF = 'partner-payout:';
