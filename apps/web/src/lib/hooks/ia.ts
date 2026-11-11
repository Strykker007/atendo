'use client';
/** IA e copiloto. */
'use client';
import { useHasFeature } from './fluxos';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';
import type { AiKeyProvider, AiOwnKeyStatus } from '@atendo/shared';

// ---- IA ----
export type RewriteTone = 'formal' | 'friendly' | 'short' | 'clear';
export interface AiUsageSummary { period: string; interactions: number; costBrl: number; failed: number; ownKeyInteractions?: number; byKind: { kind: string; count: number; costBrl: number; tokensIn: number; tokensOut: number }[] }

/** IA configurada neste ambiente? Sem chave, o front esconde os botões em vez de dar erro. */
export const useAiStatus = () => {
  const feature = useHasFeature('ai_copilot');
  const q = useQuery({ queryKey: ['ai-status'], enabled: feature.has, retry: false, staleTime: 5 * 60_000, queryFn: () => api<{ available: boolean }>('/ai/status') });
  return { enabled: feature.has && !!q.data?.available };
};
export const useAiUsage = () => useQuery({ queryKey: ['ai-usage'], queryFn: () => api<AiUsageSummary>('/ai/usage'), retry: false });
const invAi = (qc: ReturnType<typeof useQueryClient>) => () => qc.invalidateQueries({ queryKey: ['ai-usage'] });
export const useAiSuggest = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (conversationId: string) => api<{ text: string }>('/ai/suggest', { method: 'POST', body: JSON.stringify({ conversationId }) }), onSuccess: invAi(qc) }); };
export const useAiRewrite = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { text: string; tone: RewriteTone; conversationId?: string }) => api<{ text: string }>('/ai/rewrite', { method: 'POST', body: JSON.stringify(b) }), onSuccess: invAi(qc) }); };
export interface AiSummary { text: string; updatedAt: string; cached: boolean }
/** Resumo vem do cache enquanto não há mensagem nova; `force` gera de novo (e cobra). */
export const useAiSummary = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { conversationId: string; force?: boolean }) => api<AiSummary>('/ai/summary', { method: 'POST', body: JSON.stringify(b) }), onSuccess: (r) => { if (!r.cached) invAi(qc)(); } }); };

// ---- chave de IA própria (feature ai_own_key) ----
const OWN_KEY = ['ai-own-key'];
export const useAiOwnKey = (enabled = true) => useQuery({ queryKey: OWN_KEY, enabled, queryFn: () => api<AiOwnKeyStatus>('/ai/own-key'), staleTime: 60_000 });
const invOwnKey = (qc: ReturnType<typeof useQueryClient>) => (d: AiOwnKeyStatus) => { qc.setQueryData(OWN_KEY, d); qc.invalidateQueries({ queryKey: ['ai-status'] }); };
export const useSaveAiOwnKey = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { provider: AiKeyProvider; apiKey: string; model?: string }) => api<AiOwnKeyStatus>('/ai/own-key', { method: 'PUT', body: JSON.stringify(b) }), onSuccess: invOwnKey(qc) }); };
export const useRemoveAiOwnKey = () => { const qc = useQueryClient(); return useMutation({ mutationFn: () => api<AiOwnKeyStatus>('/ai/own-key', { method: 'DELETE' }), onSuccess: invOwnKey(qc) }); };

/** Uso da chave própria hoje/no mês e situação dos modelos do Gemini (docs/15-ia.md#uso-da-chave-própria). */
export interface AiOwnKeyUsage {
  provider: AiKeyProvider | null;
  today: { answered: number; limited: number; failed: number; viaCredit: number };
  month: { answered: number; viaCredit: number };
  models: { model: string; state: 'free' | 'minute' | 'daily'; until: string | null }[];
}
export const useAiOwnKeyUsage = (enabled: boolean) => useQuery({ queryKey: ['ai-own-key-usage'], enabled, queryFn: () => api<AiOwnKeyUsage>('/ai/own-key/usage'), refetchInterval: 60_000 });

// ---- saldo de IA (docs/15-ia.md#saldo-de-ia) ----
export interface AiCreditPurchaseRow { id: string; amountBrl: number; status: 'pending' | 'paid' | 'canceled'; paidVia: 'asaas' | 'manual' | null; externalId: string | null; note: string | null; paidAt: string | null; createdAt: string }
export interface AiCredits {
  balanceBrl: number;
  autoUseOnFreeLimit: boolean;
  avgPriceBrl: number;
  estimatedInteractions: number;
  month: { spentBrl: number; interactions: number };
  purchases: AiCreditPurchaseRow[];
  limits: { min: number; max: number };
  hasDocument: boolean;
}
const CREDITS = ['ai-credits'];
export const useAiCredits = (enabled = true) => useQuery({ queryKey: CREDITS, enabled, queryFn: () => api<AiCredits>('/ai/credits'), retry: false });
export const useSetAiCreditAuto = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (autoUseOnFreeLimit: boolean) => api<AiCredits>('/ai/credits/settings', { method: 'PUT', body: JSON.stringify({ autoUseOnFreeLimit }) }), onSuccess: (d) => qc.setQueryData(CREDITS, d) }); };
export const useBuyAiCredits = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { amountBrl: number; document?: string }) => api<{ purchaseId: string; payment: import('./cobranca').AsaasPayment }>('/ai/credits/purchase', { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: CREDITS }) }); };
export const useCancelAiCredits = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api<AiCredits>(`/ai/credits/purchase/${id}`, { method: 'DELETE' }), onSuccess: (d) => qc.setQueryData(CREDITS, d) }); };

export interface AiCreditsOverview {
  period: string;
  markupPct: number;
  avgCostBrl: number;
  avgPriceBrl: number;
  soldBrl: number;
  soldCount: number;
  consumedBrl: number;
  consumedInteractions: number;
  costBrl: number;
  profitBrl: number;
  outstandingBrl: number;
  recent: { id: string; tenantId: string; tenantName: string; amountBrl: number; status: string; paidVia: string | null; note: string | null; createdAt: string }[];
}
const CREDITS_ADMIN = ['ai-credits-admin'];
export const useAiCreditsOverview = () => useQuery({ queryKey: CREDITS_ADMIN, queryFn: () => api<AiCreditsOverview>('/admin/ai-credits') });
export const useSetAiMarkup = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (markupPct: number) => api<AiCreditsOverview>('/admin/ai-credits/markup', { method: 'PUT', body: JSON.stringify({ markupPct }) }), onSuccess: (d) => qc.setQueryData(CREDITS_ADMIN, d) }); };
export const useGrantAiCredits = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { tenantId: string; amountBrl: number; note?: string }) => api(`/admin/ai-credits/tenants/${b.tenantId}/grant`, { method: 'POST', body: JSON.stringify({ amountBrl: b.amountBrl, note: b.note }) }), onSuccess: () => qc.invalidateQueries({ queryKey: CREDITS_ADMIN }) }); };
