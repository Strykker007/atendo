'use client';
/** Planos, assinatura e financeiro do dono. */
'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { BillingCycle, ConversationStatus, PlanLimits, PlanLimitsOverride, FlowDefinition, FlowTrigger, Permission } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';

// ---- Cobrança (Stripe) ----
export interface Plan { id: string; name: string; priceMonth: string; priceYear: string | null; isFree: boolean; billingCycle: BillingCycle; durationDays: number | null; billingModel: string; limits: PlanLimits; stripePriceId: string | null; /** promoção que este cliente ganha ao assinar (docs/05#promoções) */ promotion: { name: string; discountPercent: number; durationMonths: number; endsAt: string; priceMonth: number } | null }
export interface Invoice { id: string; period: string; baseAmount: string; overageAmount: string; totalAmount: string; currency: string; status: 'draft' | 'open' | 'paid' | 'failed' | 'void'; hostedUrl: string | null; dueAt: string | null; paidAt: string | null; createdAt: string }
export const usePlans = () => useQuery({ queryKey: ['plans'], queryFn: () => api<Plan[]>('/billing/plans') });
export const useInvoices = () => useQuery({ queryKey: ['invoices'], queryFn: () => api<Invoice[]>('/billing/invoices') });
export const useCheckout = () => useMutation({ mutationFn: (planId: string) => api<{ url: string }>('/billing/checkout', { method: 'POST', body: JSON.stringify({ planId }) }) });
export const usePortal = () => useMutation({ mutationFn: () => api<{ url: string }>('/billing/portal', { method: 'POST' }) });

// ---- Cobrança (Asaas: PIX + cartão) ----
export interface AsaasPayment { id: string; status: string; paid: boolean; billingType: string; value: number; dueDate: string; invoiceUrl: string | null; pix: { encodedImage: string; payload: string; expirationDate: string } | null }
export interface AsaasCustomerData { name: string; cpfCnpj: string; email: string | null; mobilePhone: string | null; postalCode: string | null; addressNumber: string | null }
export interface AsaasCheckoutInput {
  planId: string;
  billingType: 'PIX' | 'CREDIT_CARD';
  customer: { name?: string; cpfCnpj: string; email?: string; mobilePhone?: string };
  card?: { holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string };
  holder?: { name: string; email: string; cpfCnpj: string; postalCode: string; addressNumber: string; phone: string };
}
export const useAsaasCustomer = (enabled: boolean) => useQuery({ queryKey: ['asaas-customer'], queryFn: () => api<AsaasCustomerData | null>('/billing/asaas/customer'), enabled, staleTime: Infinity });
export const useAsaasPending = (enabled: boolean) => useQuery({ queryKey: ['asaas-pending'], queryFn: () => api<{ payment: AsaasPayment | null }>('/billing/asaas/pending'), enabled });
export const useAsaasCheckout = () => useMutation({ mutationFn: (input: AsaasCheckoutInput) => api<{ payment: AsaasPayment | null }>('/billing/asaas/checkout', { method: 'POST', body: JSON.stringify(input) }) });
/** Polling do PIX: consulta o Asaas a cada 4 s até a cobrança ser paga. */
export const useAsaasPaymentStatus = (id: string | null, active: boolean) =>
  useQuery({ queryKey: ['asaas-payment', id], queryFn: () => api<AsaasPayment>(`/billing/asaas/payments/${id}`), enabled: !!id && active, refetchInterval: 4000 });

// ---- Painel de vencimentos (grupo + empresas) ----
export type DueState = 'ok' | 'due_soon' | 'overdue' | 'free';
export interface DueRow {
  key: string;
  /** group = assinatura do cliente; member = empresa que herda (paga junto com o grupo); company = assinatura própria */
  kind: 'group' | 'member' | 'company';
  companyId: string | null;
  name: string;
  plan: string | null;
  cycle: 'monthly' | 'yearly' | null;
  status: string | null;
  state: DueState | null;
  daysToDue: number | null;
  amount: number;
  dueDate: string | null;
  units: number;
  payable: boolean;
  reason: string | null;
  openChargeId: string | null;
}
export interface Dues {
  billingType: 'INDIVIDUAL' | 'CONSOLIDATED_GROUP';
  online: boolean;
  summary: { totalMonth: number; overdueCount: number; overdueAmount: number; nextDue: { name: string; dueDate: string; amount: number; daysToDue: number | null } | null };
  rows: DueRow[];
}
export const useDues = () => useQuery({ queryKey: ['dues'], queryFn: () => api<Dues>('/billing/dues') });
export const usePayDues = () => useMutation({ mutationFn: (b: { keys: string[]; cpfCnpj?: string }) => api<{ payment: AsaasPayment }>('/billing/dues/pay', { method: 'POST', body: JSON.stringify(b) }) });
/** Reabre uma cobrança já emitida (com o QR do PIX). */
export const fetchAsaasPayment = (id: string) => api<AsaasPayment>(`/billing/asaas/payments/${encodeURIComponent(id)}?pix=1`);

export interface MarginRow { tenantId: string; name: string; plan: string | null; status: string | null; revenue: number; overage: number; providerCost: number; infraCost: number; margin: number; marginPct: number; messagesSent: number; templatesSent: number }
export const useMargin = (period?: string) => useQuery({ queryKey: ['margin', period], queryFn: () => api<MarginRow[]>(`/billing/margin${period ? `?period=${period}` : ''}`) });

// ---- Financeiro (dono) ----
export interface FinanceOverview {
  now: { mrr: number; arr: number; activeTenants: number; trialing: number; pastDue: number; suspended: number; canceled: number; overdueAmount: number; monthCost: number; monthMargin: number; /** MRR que deixa de entrar por desconto vigente */ discountMonth: number; discountedTenants: number; /** mensalidade que entra se todo teste converter */ trialMrr: number; trialsEndingSoon: number };
  byPlan: { plan: string; count: number; trialing: number; mrr: number; cost: number; margin: number }[];
  series: { period: string; invoiced: number; received: number; overdue: number; overage: number; providerCost: number; infraCost: number; messagesSent: number; newTenants: number; canceled: number; /** desconto concedido no mês (livro de descontos) */ discounts: number }[];
  invoices: { id: string; tenant: string; period: string; total: number; overage: number; status: string; dueAt: string | null; paidAt: string | null; hostedUrl: string | null }[];
  /** em teste sem pagamento, por fim do teste (mais próximo primeiro). daysLeft < 0 = teste vencido */
  trials: { tenant: string; plan: string; price: number; startedAt: string; endsAt: string; daysIn: number; daysLeft: number }[];
  subscriptions: { tenant: string; plan: string; price: number; status: string; periodEnd: string; cancelAtPeriodEnd: boolean; graceUntil: string | null }[];
  /** livro de descontos inteiro, mais recente primeiro (docs/05#livro-de-descontos) */
  discounts: DiscountGrant[];
}
export type DiscountSource = 'checkout' | 'tenant_create' | 'manual' | 'bulk' | 'plan_return';
export interface DiscountGrant { id: string; tenant: string; plan: string; kind: 'promotion' | 'negotiated'; source: DiscountSource; promotion: string | null; listPrice: number; priceMonth: number; discountPercent: number; units: number; startsAt: string; endsAt: string | null; closedAt: string | null; grantedBy: string | null; createdAt: string }
export const useFinance = (months = 12) => useQuery({ queryKey: ['finance', months], queryFn: () => api<FinanceOverview>(`/billing/finance?months=${months}`) });

// ---- Personalização do plano por cliente (dono) — docs/05-planos-e-cobranca.md#personalização-por-cliente ----
export interface PlanOverrideView {
  subscription: { planId: string; status: string; gateway: 'stripe' | 'asaas' | null; units: number; priceMonth: number | null; plan: { id: string; name: string; priceMonth: number; billingCycle: BillingCycle; isFree: boolean; limits: PlanLimits } } | null;
  override: { planId: string; priceMonth: number | null; limits: PlanLimitsOverride; expiresAt: string | null; endedAt: string | null; notes: string | null; updatedAt: string; /** nasceu de uma promoção */ promotionId: string | null; promotion: { name: string } | null } | null;
  active: boolean;
  /** existe e não vale: o cliente trocou de plano, ou a data limite passou */
  inactiveReason: 'other_plan' | 'expired' | null;
  effectiveLimits: PlanLimits | null;
}
export interface PlanOverrideInput { priceMonth: number | null; limits: PlanLimitsOverride; /** AAAA-MM-DD */ expiresAt: string | null; notes: string | null }
export const usePlanOverride = (tenantId: string) => useQuery({ queryKey: ['plan-override', tenantId], queryFn: () => api<PlanOverrideView>(`/billing/overrides/${tenantId}`) });
export const useSavePlanOverride = (tenantId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: PlanOverrideInput) => api<PlanOverrideView>(`/billing/overrides/${tenantId}`, { method: 'PUT', body: JSON.stringify(b) }),
    onSuccess: (v) => { qc.setQueryData(['plan-override', tenantId], v); qc.invalidateQueries({ queryKey: ['tenants'] }); qc.invalidateQueries({ queryKey: ['finance'] }); },
  });
};
export const useDeletePlanOverride = (tenantId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/billing/overrides/${tenantId}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plan-override', tenantId] }); qc.invalidateQueries({ queryKey: ['tenants'] }); qc.invalidateQueries({ queryKey: ['finance'] }); },
  });
};

// ---- Promoções de entrada (dono) — docs/05-planos-e-cobranca.md#promoções ----
export interface Promotion { id: string; name: string; discountPercent: number; durationMonths: number; planIds: string[]; startsAt: string; endsAt: string; isActive: boolean; redemptions: number }
/** datas em `AAAA-MM-DD`; `startsAt` vazio = a partir de agora; `endsAt` = último dia para assinar */
export interface PromotionInput { name: string; discountPercent: number; durationMonths: number; planIds: string[]; startsAt?: string | null; endsAt: string; isActive?: boolean }
export const usePromotions = () => useQuery({ queryKey: ['promotions'], queryFn: () => api<Promotion[]>('/billing/promotions') });
export const useSavePromotion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: PromotionInput & { id?: string }) => api<Promotion>(id ? `/billing/promotions/${id}` : '/billing/promotions', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['promotions'] }); qc.invalidateQueries({ queryKey: ['plans'] }); },
  });
};
export const useDeletePromotion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/billing/promotions/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['promotions'] }); qc.invalidateQueries({ queryKey: ['plans'] }); },
  });
};
/** Aplica uma promoção só a este cliente (exceção do dono). */
export const useApplyPromotion = (tenantId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (promotionId: string) => api<PlanOverrideView>(`/billing/overrides/${tenantId}/promotion`, { method: 'POST', body: JSON.stringify({ promotionId }) }),
    onSuccess: (v) => { qc.setQueryData(['plan-override', tenantId], v); qc.invalidateQueries({ queryKey: ['tenants'] }); qc.invalidateQueries({ queryKey: ['finance'] }); qc.invalidateQueries({ queryKey: ['promotions'] }); },
  });
};
/** Aplica a promoção a todos os clientes dos planos dela; devolve quem ficou de fora e por quê. */
export const useApplyPromotionToAll = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ applied: number; skipped: { tenant: string; reason: string }[] }>(`/billing/promotions/${id}/apply-all`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['promotions'] }); qc.invalidateQueries({ queryKey: ['tenants'] }); qc.invalidateQueries({ queryKey: ['finance'] }); },
  });
};

/** CPF/CNPJ informado pelo aviso do painel: grava e já põe o cliente na cobrança automática por Pix. */
export const useSetBillingDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cpfCnpj: string) => api<{ enrolled: boolean }>('/billing/monthly/document', { method: 'POST', body: JSON.stringify({ cpfCnpj }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['usage'] }); qc.invalidateQueries({ queryKey: ['asaas-pending'] }); },
  });
};

/** Linha da migração para a mensalidade por Pix no Asaas (dono do sistema). */
export interface PixEnrollRow { tenantId: string; tenant: string; plan: string; value: number; dueDate: string | null; result: 'enrolled' | 'would_enroll' | 'already' | 'free' | 'no_price' | 'not_live' | 'no_document' | 'error'; error?: string }
/** `dryRun: true` = só a prévia (nada é criado no Asaas). */
export const usePixEnroll = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dryRun: boolean) => api<PixEnrollRow[]>('/billing/monthly/enroll', { method: 'POST', body: JSON.stringify({ dryRun }) }),
    onSuccess: (_, dryRun) => { if (!dryRun) qc.invalidateQueries({ queryKey: ['finance'] }); },
  });
};

/** Cobrança por Pix liberada para os clientes (botão do dono). `asaasConfigured` = há chave do Asaas no servidor. */
export interface PixSettings { asaasConfigured: boolean; clientBilling: boolean; autoEnroll: boolean }
export const usePixSettings = () => useQuery({ queryKey: ['pix-settings'], queryFn: () => api<PixSettings>('/billing/monthly/settings') });
export const useSetPixSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientBilling: boolean) => api<PixSettings>('/billing/monthly/settings', { method: 'PUT', body: JSON.stringify({ clientBilling }) }),
    onSuccess: (r) => { qc.setQueryData(['pix-settings'], r); qc.invalidateQueries({ queryKey: ['usage'] }); },
  });
};
