'use client';
/** Fluxos de automação. */
'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission, PortableFlow, PortableFlowBundle } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';
import { invConv, useUsage } from './core';

// ---- Fluxos de automação ----
export interface FlowSummary { id: string; name: string; description: string | null; isActive: boolean; showInChat: boolean; trigger: FlowTrigger; updatedAt: string; _count: { runs: number } }
/** `mediaUrls`: link assinado de cada anexo do Conteúdo (só na leitura de um fluxo). */
export interface Flow { id: string; name: string; description: string | null; isActive: boolean; showInChat: boolean; trigger: FlowTrigger; definition: FlowDefinition; updatedAt: string; mediaUrls?: Record<string, string>; /** optimistic locking: mandar no PATCH do editor */ version: number }
export interface ActiveRun { id: string; status: 'running' | 'waiting'; currentNodeId: string | null; flow: { id: string; name: string }; startedAt: string; waitUntil: string | null }
export interface FlowRuns { byStatus: Record<string, number>; recent: { id: string; status: string; startedAt: string; endedAt: string | null; error: string | null; contact: { name: string | null; phone: string }; conversationId: string }[] }

export const useFlows = () => useQuery({ queryKey: ['flows'], queryFn: () => api<FlowSummary[]>('/flows'), retry: false });
export const useFlow = (id: string | null) => useQuery({ queryKey: ['flow', id], enabled: !!id && id !== 'novo', queryFn: () => api<Flow>(`/flows/${id}`) });
export const useFlowRuns = (id: string | null) => useQuery({ queryKey: ['flow-runs', id], enabled: !!id && id !== 'novo', queryFn: () => api<FlowRuns>(`/flows/${id}/runs`) });
const invFlows = (qc: ReturnType<typeof useQueryClient>) => () => { qc.invalidateQueries({ queryKey: ['flows'] }); qc.invalidateQueries({ queryKey: ['flow'] }); };
export const useCreateFlow = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: Omit<Flow, 'id' | 'updatedAt'>) => api<Flow>('/flows', { method: 'POST', body: JSON.stringify(b) }), onSuccess: invFlows(qc) }); };
export const useUpdateFlow = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: Partial<Flow> & { id: string }) => api<Flow>(`/flows/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: invFlows(qc) }); };
/** Fluxos com "Conectar com outro fluxo" apontando para este — aviso antes de excluir. */
export const fetchFlowReferences = (id: string) => api<{ id: string; name: string }[]>(`/flows/${id}/references`);
export const useDeleteFlow = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/flows/${id}`, { method: 'DELETE' }), onSuccess: invFlows(qc) }); };
/** Cópia dentro do mesmo cliente — mantém etiquetas, atendentes e anexos. */
export const useDuplicateFlow = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api<Flow>(`/flows/${id}/duplicate`, { method: 'POST' }), onSuccess: invFlows(qc) }); };
/** Arquivo para levar o fluxo a OUTRO cliente; `warnings` diz o que não viajou. */
export const useExportFlow = () => useMutation({ mutationFn: (id: string) => api<{ portable: PortableFlow; warnings: string[] }>(`/flows/${id}/export`) });
/** Lote: cada item é exatamente o arquivo individual (`PortableFlowBundle`, shared/portable.ts). */
export const useExportFlows = () => useMutation({ mutationFn: (ids: string[]) => api<{ bundle: PortableFlowBundle; warnings: string[] }>('/flows/export', { method: 'POST', body: JSON.stringify({ ids }) }) });
export const useDuplicateFlows = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (ids: string[]) => api<{ flows: Flow[] }>('/flows/duplicate', { method: 'POST', body: JSON.stringify({ ids }) }), onSuccess: invFlows(qc) }); };
/** Ativa/desativa vários. Ativar valida cada desenho: os inválidos voltam em `failed` com o motivo e ficam como estavam. */
export const useSetFlowsActive = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { ids: string[]; isActive: boolean }) => api<{ updated: number; failed: { id: string; name: string; reason: string }[] }>('/flows/active', { method: 'POST', body: JSON.stringify(b) }), onSuccess: invFlows(qc) }); };
/** Aceita o arquivo individual ou o lote — quem decide é a API. */
export const useImportFlow = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (portable: unknown) => api<{ flows: Flow[]; warnings: string[] }>('/flows/import', { method: 'POST', body: JSON.stringify({ portable }) }), onSuccess: invFlows(qc) }); };
export const useStartFlow = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ flowId, conversationId, resumeBot }: { flowId: string; conversationId: string; resumeBot?: boolean }) => api(`/flows/${flowId}/start`, { method: 'POST', body: JSON.stringify({ conversationId, ...(resumeBot && { resumeBot }) }) }), onSuccess: (_, v) => { qc.refetchQueries({ queryKey: ['active-run', v.conversationId] }); invConv(qc, v.conversationId); } }); };
export const useStopFlow = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (conversationId: string) => api(`/conversations/${conversationId}/flow/stop`, { method: 'POST' }), onSuccess: (_, id) => { qc.refetchQueries({ queryKey: ['active-run', id] }); invConv(qc, id); } }); };
/** Robô pausado agora? Pausa vencida conta como retomada mesmo antes do aviso do servidor chegar. */
export const botPaused = (c: { botPausedAt?: string | null; botPausedUntil?: string | null }, now = Date.now()) =>
  !!c.botPausedAt && (!c.botPausedUntil || new Date(c.botPausedUntil).getTime() > now);
/** `minutes` nulo = até retomar manualmente. */
export const usePauseBot = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ conversationId, minutes }: { conversationId: string; minutes: number | null }) => api(`/conversations/${conversationId}/bot/pause`, { method: 'POST', body: JSON.stringify({ minutes }) }), onSuccess: (_, v) => { qc.refetchQueries({ queryKey: ['active-run', v.conversationId] }); invConv(qc, v.conversationId); qc.invalidateQueries({ queryKey: ['conversation-events', v.conversationId] }); } }); };
export const useResumeBot = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (conversationId: string) => api(`/conversations/${conversationId}/bot/resume`, { method: 'POST' }), onSuccess: (_, id) => { invConv(qc, id); qc.invalidateQueries({ queryKey: ['conversation-events', id] }); } }); };
export const useActiveRun = (conversationId: string | null) => useQuery({ queryKey: ['active-run', conversationId], enabled: !!conversationId, queryFn: () => api<ActiveRun | null>(`/conversations/${conversationId}/flow`), refetchInterval: 15_000 });
/** O plano inclui a funcionalidade? (usa /billing/usage já em cache) */
export const useHasFeature = (feature: string) => { const u = useUsage(); return { has: !!u.data?.limits?.features?.includes(feature as any), loading: u.isLoading }; };

// ---- Clientes (dono) ----
export interface TenantRow { id: string; name: string; slug: string; isActive: boolean; createdAt: string; subscription: { status: string; currentPeriodEnd: string; plan: { id: string; name: string; priceMonth: string } } | null; users: { email: string; name: string }[]; _count: { numbers: number; users: number; conversations: number } }
export const useTenants = () => useQuery({ queryKey: ['tenants'], queryFn: () => api<TenantRow[]>('/tenants') });
export const useCreateTenant = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { name: string; slug: string; planId: string; adminEmail: string; adminName: string; adminPassword?: string }) => api('/tenants', { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['tenants'] }) }); };
export const useUpdateTenant = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; isActive?: boolean; planId?: string; subscriptionStatus?: string }) => api(`/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenants'] }); qc.invalidateQueries({ queryKey: ['finance'] }); } }); };
export const useImpersonate = () => useMutation({ mutationFn: (tenantId: string) => api<{ accessToken: string; tenant: { id: string; name: string } }>(`/tenants/${tenantId}/impersonate`, { method: 'POST' }) });

// ---- Relatórios: visão pronta ----
export interface ReportOverview {
  period: { from: string; to: string };
  kpis: { conversations: number; closed: number; closeRate: number; waitingNow: number; inProgressNow: number; messagesIn: number; messagesOut: number; avgFirstResponseMin: number | null; won: number; lost: number; revenue: number; winRate: number | null };
  series: Record<'byDay' | 'byAgent' | 'byOrigin' | 'byCampaign' | 'byTag' | 'byStatus', { label: string; value: number }[]>;
}
export const useReportOverview = (from: string, to: string) => useQuery({ queryKey: ['report-overview', from, to], queryFn: () => api<ReportOverview>(`/reports/overview?from=${from}&to=${to}`) });
