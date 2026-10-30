'use client';
/** Orçamentos com link público, gerados no chat (docs/orcamentos.md). */
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BudgetItem, BudgetStatus, BudgetValidity } from '@atendo/shared';
import { api } from '../api';

export interface Budget {
  id: string;
  hash: string;
  /** "Orçamento Nº 42"; null nos anteriores à numeração */
  number: number | null;
  /** enviado por texto, esperando o cliente aprovar — o link ainda não vale */
  awaitingApproval: boolean;
  quotedAt: string | null;
  approvedAt: string | null;
  items: BudgetItem[];
  totalValue: number;
  /** desconto em R$ (o total já vem descontado) */
  discountValue: number;
  /** desconto dado em % (só para mostrar) */
  discountPercent: number | null;
  status: BudgetStatus;
  expiresAt: string;
  createdAt: string;
  paidAt: string | null;
  /** manual (atendente) | asaas (webhook do Pix automático) */
  paidVia: 'manual' | 'asaas' | null;
  autoPix: boolean;
  refundedAt: string | null;
  /** já entrou num encerramento "Comprou" (não soma de novo) */
  absorbed: boolean;
  note: string | null;
  pixKey: string | null;
  paymentUrl: string | null;
  user: { id: string; name: string };
  receipt: { url: string; mimeType: string; fileName: string; at: string } | null;
}
type CreateBody = { items: BudgetItem[]; pixKeyId?: string; paymentUrl?: string; note?: string; validity?: BudgetValidity; autoPix?: boolean; cpfCnpj?: string; quote?: boolean; discount?: number; discountPercent?: number };

/** Link público do orçamento — no domínio aberto agora, para sair com a marca certa. */
export const budgetLink = (hash: string) => `${typeof window === 'undefined' ? '' : window.location.origin}/o/${hash}`;

/** O socket `budgets` invalida (comprovante chegou, marcado como pago) — ver numeros.ts. */
export const useBudgets = (conversationId: string | null) =>
  useQuery({
    queryKey: ['budgets', conversationId],
    enabled: !!conversationId,
    queryFn: () => api<Budget[]>(`/conversations/${conversationId}/budgets`),
  });

export const useCreateBudget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, ...body }: CreateBody & { conversationId: string }) =>
      api<Budget>(`/conversations/${conversationId}/budgets`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ['budgets', v.conversationId] });
      // CPF digitado no orçamento foi para a ficha
      if (v.cpfCnpj) qc.invalidateQueries({ queryKey: ['conversation', v.conversationId] });
    },
  });
};

/** Estorno (gestão): Pix automático pede a devolução ao Asaas; por fora, só registra. A venda sai da meta. */
export const useRefundBudget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, id }: { conversationId: string; id: string }) => api<Budget>(`/conversations/${conversationId}/budgets/${id}/refund`, { method: 'POST' }),
    onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['budgets', v.conversationId] }),
  });
};

/** Cliente aprovou o orçamento por texto: libera o link DESTE orçamento (e gera o Pix automático). `link: false` = cartão/dinheiro, sem Pix. */
export const useApproveBudget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, id, link = true }: { conversationId: string; id: string; link?: boolean }) =>
      api<Budget>(`/conversations/${conversationId}/budgets/${id}/approve`, { method: 'POST', body: JSON.stringify({ link }) }),
    onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['budgets', v.conversationId] }),
  });
};

/** PAID/PENDING = pago por fora e desfazer; EXPIRED = descartar orçamento ainda sem aprovação. */
export const useSetBudgetStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, id, status }: { conversationId: string; id: string; status: 'PENDING' | 'PAID' | 'EXPIRED' }) =>
      api<Budget>(`/conversations/${conversationId}/budgets/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['budgets', v.conversationId] }),
  });
};

// ---- Relatórios → Pagamentos (docs/orcamentos.md#relatório-de-pagamentos) ----
export interface BudgetListRow extends Budget {
  conversationId: string;
  contact: { id: string; name: string | null; phone: string };
  paidAfterExpiry: boolean;
}
export interface BudgetList {
  page: number;
  pageSize: number;
  total: number;
  totals: {
    byStatus: Partial<Record<BudgetStatus, { count: number; value: number }>>;
    paidByVia: Partial<Record<'asaas' | 'manual', { count: number; value: number }>>;
  };
  rows: BudgetListRow[];
}
export type BudgetListFilters = { status?: BudgetStatus; via?: 'auto' | 'fora'; userId?: string; from?: string; to?: string; search?: string; page?: number };
export const useAllBudgets = (f: BudgetListFilters) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
  return useQuery({ queryKey: ['budgets-all', qs.toString()], queryFn: () => api<BudgetList>(`/budgets?${qs}`), placeholderData: keepPreviousData });
};
