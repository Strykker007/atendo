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
export interface MarginRow { tenantId: string; name: string; plan: string | null; status: string | null; revenue: number; overage: number; providerCost: number; infraCost: number; margin: number; marginPct: number; messagesSent: number; templatesSent: number }
export const useMargin = (period?: string) => useQuery({ queryKey: ['margin', period], queryFn: () => api<MarginRow[]>(`/billing/margin${period ? `?period=${period}` : ''}`) });

// ---- Financeiro (dono) ----
export interface FinanceOverview {
  now: { mrr: number; arr: number; activeTenants: number; trialing: number; pastDue: number; suspended: number; canceled: number; overdueAmount: number; monthCost: number; monthMargin: number };
  byPlan: { plan: string; count: number; mrr: number; cost: number; margin: number }[];
  series: { period: string; invoiced: number; received: number; overdue: number; overage: number; providerCost: number; infraCost: number; messagesSent: number; newTenants: number; canceled: number }[];
  invoices: { id: string; tenant: string; period: string; total: number; overage: number; status: string; dueAt: string | null; paidAt: string | null; hostedUrl: string | null }[];
  subscriptions: { tenant: string; plan: string; price: number; status: string; periodEnd: string; cancelAtPeriodEnd: boolean; graceUntil: string | null }[];
}
export const useFinance = (months = 12) => useQuery({ queryKey: ['finance', months], queryFn: () => api<FinanceOverview>(`/billing/finance?months=${months}`) });
