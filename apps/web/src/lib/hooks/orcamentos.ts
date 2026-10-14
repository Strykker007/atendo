'use client';
/** Orçamentos com link público, gerados no chat (docs/orcamentos.md). */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BudgetItem, BudgetStatus, BudgetValidity } from '@atendo/shared';
import { api } from '../api';

export interface Budget {
  id: string;
  hash: string;
  items: BudgetItem[];
  totalValue: number;
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
type CreateBody = { items: BudgetItem[]; pixKeyId?: string; paymentUrl?: string; note?: string; validity?: BudgetValidity; autoPix?: boolean; cpfCnpj?: string };

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

export const useSetBudgetStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, id, status }: { conversationId: string; id: string; status: 'PENDING' | 'PAID' }) =>
      api<Budget>(`/conversations/${conversationId}/budgets/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['budgets', v.conversationId] }),
  });
};
