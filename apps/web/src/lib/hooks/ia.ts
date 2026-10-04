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

// ---- IA ----
export type RewriteTone = 'formal' | 'friendly' | 'short' | 'clear';
export interface AiUsageSummary { period: string; interactions: number; costBrl: number; failed: number; byKind: { kind: string; count: number; costBrl: number; tokensIn: number; tokensOut: number }[] }

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
