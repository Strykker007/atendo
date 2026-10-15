import type { PixKeyType } from './messages.js';

/**
 * Orçamento/pedido com link público (docs/orcamentos.md). No WhatsApp vai só um texto
 * genérico com o link — itens, valores e chave Pix ficam na página, fora da conversa.
 */
export const BUDGET_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'REFUNDED'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];
export const BUDGET_STATUS_LABEL: Record<BudgetStatus, string> = { PENDING: 'Aguardando pagamento', PAID: 'Pago', EXPIRED: 'Expirado', REFUNDED: 'Estornado' };

/** Teto de `validHours` (API). A tela usa as opções de `BUDGET_VALIDITY`. */
export const BUDGET_DEFAULT_HOURS = 48;
export const BUDGET_MAX_HOURS = 24 * 30;

/**
 * Validade do orçamento (docs/orcamentos.md#vencimento). `end_of_day` = 23:59:59 do dia, no fuso
 * da empresa — o padrão: proposta de farmácia vale para hoje. Mínimo de 30 min (gerado às 23:50
 * não vence em 9 min: vai para 00:20).
 */
export const BUDGET_VALIDITY = ['1h', '2h', '4h', '8h', 'end_of_day', '24h', '48h'] as const;
export type BudgetValidity = (typeof BUDGET_VALIDITY)[number];
export const BUDGET_VALIDITY_LABEL: Record<BudgetValidity, string> = { '1h': '1 hora', '2h': '2 horas', '4h': '4 horas', '8h': '8 horas', end_of_day: 'Até o fim do dia', '24h': '24 horas', '48h': '48 horas' };
export const BUDGET_DEFAULT_VALIDITY: BudgetValidity = 'end_of_day';
export const BUDGET_MIN_VALIDITY_MIN = 30;
/**
 * Tolerância depois do vencimento antes de cancelar a cobrança no Asaas. No vencimento a página
 * já some com o QR; quem colou o código antes tem estes minutos para o banco processar.
 */
export const BUDGET_GRACE_MINUTES = 10;
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
  /** Pix automático: o cliente gera a cobrança na página (pede CPF) e o webhook dá a baixa */
  autoPix: boolean;
  /** cobrança já gerada (só enquanto PENDING) */
  pixCharge: { payload: string; qrImage: string } | null;
}

/** CPF (11) ou CNPJ (14), só dígitos — o Asaas exige um dos dois para gerar a cobrança. */
export const isCpfCnpjLength = (v: string) => [11, 14].includes(v.replace(/\D/g, '').length);
