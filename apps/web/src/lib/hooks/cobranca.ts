'use client';
/** Planos, assinatura e financeiro do dono. */
'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { BillingCycle, ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';

// ---- Cobrança (Stripe) ----
export interface Plan { id: string; name: string; priceMonth: string; priceYear: string | null; isFree: boolean; billingCycle: BillingCycle; durationDays: number | null; billingModel: string; limits: PlanLimits; stripePriceId: string | null }
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
  now: { mrr: number; arr: number; activeTenants: number; trialing: number; pastDue: number; suspended: number; canceled: number; overdueAmount: number; monthCost: number; monthMargin: number };
  byPlan: { plan: string; count: number; trialing: number; mrr: number; cost: number; margin: number }[];
  series: { period: string; invoiced: number; received: number; overdue: number; overage: number; providerCost: number; infraCost: number; messagesSent: number; newTenants: number; canceled: number }[];
  invoices: { id: string; tenant: string; period: string; total: number; overage: number; status: string; dueAt: string | null; paidAt: string | null; hostedUrl: string | null }[];
  subscriptions: { tenant: string; plan: string; price: number; status: string; periodEnd: string; cancelAtPeriodEnd: boolean; graceUntil: string | null }[];
}
export const useFinance = (months = 12) => useQuery({ queryKey: ['finance', months], queryFn: () => api<FinanceOverview>(`/billing/finance?months=${months}`) });
