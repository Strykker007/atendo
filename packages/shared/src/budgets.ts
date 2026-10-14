import type { PixKeyType } from './messages.js';

/**
 * Orçamento/pedido com link público (docs/orcamentos.md). No WhatsApp vai só um texto
 * genérico com o link — itens, valores e chave Pix ficam na página, fora da conversa.
 */
export const BUDGET_STATUSES = ['PENDING', 'PAID', 'EXPIRED'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];
export const BUDGET_STATUS_LABEL: Record<BudgetStatus, string> = { PENDING: 'Aguardando pagamento', PAID: 'Pago', EXPIRED: 'Expirado' };

/** Validade padrão do link e o teto que o atendente pode escolher. */
export const BUDGET_DEFAULT_HOURS = 48;
export const BUDGET_MAX_HOURS = 24 * 30;
export const BUDGET_MAX_ITEMS = 50;
/** Comprovante pela página pública: imagem ou PDF, até este tamanho. */
export const BUDGET_RECEIPT_MAX_MB = 10;
export const BUDGET_RECEIPT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

export interface BudgetItem {
  name: string;
  /** dosagem/apresentação ("500 mg, 30 comprimidos") */
  dosage?: string;
  quantity: number;
  /** valor unitário em R$ */
  unitPrice: number;
}

/** Soma em centavos para não acumular erro de float. */
export const budgetTotal = (items: Pick<BudgetItem, 'quantity' | 'unitPrice'>[]) =>
  items.reduce((s, i) => s + Math.round(i.quantity * Math.round(i.unitPrice * 100)), 0) / 100;

/** O que a página pública recebe — nada do contato além do primeiro nome. */
export interface PublicBudget {
  tenantName: string;
  contactFirstName: string | null;
  agentName: string;
  items: BudgetItem[];
  totalValue: number;
  status: BudgetStatus;
  expiresAt: string;
  createdAt: string;
  note: string | null;
  /** só enquanto PENDING: pago ou expirado não mostra como pagar */
  pix: { key: string; keyType: PixKeyType; holderName: string } | null;
  paymentUrl: string | null;
  receiptSent: boolean;
}
