'use client';
/** Relatórios. */
'use client';
import { keepPreviousData, useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission, SurveyScale, RankingParts, RankingWeights } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';
import { ConversationOrigin, type Message } from './core';

// ---- Relatórios ----
export type ReportMetric = 'conversations' | 'messages_in' | 'messages_out' | 'avg_first_response_min' | 'closed' | 'revenue' | 'won' | 'lost' | 'win_rate';
export type ReportGroup = 'day' | 'week' | 'month' | 'tag' | 'status' | 'number' | 'agent' | 'origin' | 'campaign' | 'reason';
export interface ReportDefinition {
  metric: ReportMetric;
  groupBy: ReportGroup;
  from: string; // YYYY-MM-DD
  to: string;   // exclusivo
  filters: { tagIds?: string[]; status?: ConversationStatus; numberId?: string; origin?: ConversationOrigin; /** consultor */ agentId?: string };
  chart: 'bar' | 'line' | 'pie';
}
export interface ReportResult { definition: ReportDefinition; series: { label: string; value: number }[] }
export interface SavedReport { id: string; name: string; definition: ReportDefinition; createdAt: string }

export const useRunReport = () => useMutation({ mutationFn: (d: ReportDefinition) => api<ReportResult>('/reports/run', { method: 'POST', body: JSON.stringify(d) }) });
export const useSavedReports = () => useQuery({ queryKey: ['saved-reports'], queryFn: () => api<SavedReport[]>('/reports/saved') });
export const useSaveReport = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { name: string; definition: ReportDefinition }) => api<SavedReport>('/reports/saved', { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-reports'] }) });
};
export const useDeleteSavedReport = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/reports/saved/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-reports'] }) });
};

// ---- Relatórios: ranking de consultores ----
export interface ConsultantRankingRow {
  position: number;
  userId: string;
  name: string;
  /** atendimentos encerrados por ele no período */
  closed: number;
  /** encerrados como "Comprou" */
  won: number;
  revenue: number;
  /** 0–100 */
  conversionRate: number;
  /** tempo médio de atendimento, em minutos */
  avgHandleMin: number | null;
  /** pesquisa de satisfação (pergunta principal) na escala `satisfactionScale`; null = sem respostas */
  satisfaction: { answered: number; avg: number | null; nps: number | null } | null;
  /** nota 0–100 que define a posição (packages/shared/ranking.ts) */
  score: number;
  /** cada métrica de 0 a 100; null = sem dado (peso redistribuído) */
  scoreParts: RankingParts | null;
}
export interface ConsultantRanking { satisfactionScale: SurveyScale | null; weights: RankingWeights; totals: { closed: number; won: number; revenue: number; conversionRate: number }; ranking: ConsultantRankingRow[] }
export const useConsultantRanking = (f: { from: string; to: string; tagIds?: string[]; enabled?: boolean }) => {
  const qs = new URLSearchParams({ from: f.from, to: f.to, ...(f.tagIds?.length && { tagIds: f.tagIds.join(',') }) });
  return useQuery({ queryKey: ['consultant-ranking', qs.toString()], queryFn: () => api<ConsultantRanking>(`/reports/ranking-consultants?${qs}`), placeholderData: keepPreviousData, staleTime: 60_000, refetchOnWindowFocus: false, enabled: f.enabled !== false });
};

// ---- Metas mensais (docs/metas.md) ----
export interface GoalTarget { revenueTarget: number | null; wonTarget: number | null }
export interface MonthGoals { month: string; default: GoalTarget | null; goals: (GoalTarget & { userId: string })[] }
export type GoalStatus = 'done' | 'on_track' | 'close' | 'behind';
export interface GoalRow extends GoalTarget {
  position: number | null;
  userId: string;
  name: string;
  isActive: boolean;
  /** de onde veio a meta: própria, padrão do mês ou nenhuma */
  goalSource: 'own' | 'default' | null;
  revenue: number;
  won: number;
  revenuePct: number | null;
  wonPct: number | null;
  revenueExpected: number | null;
  revenueProjection: number | null;
  wonProjection: number | null;
  attainment: number | null;
  status: GoalStatus | null;
}
export interface GoalsProgress { month: string; elapsedPct: number; team: { revenue: number; revenueTarget: number | null; revenuePct: number | null; won: number }; ranking: GoalRow[] }
export const useMonthGoals = (month: string, enabled = true) => useQuery({ queryKey: ['sales-goals', month], queryFn: () => api<MonthGoals>(`/sales-goals/${month}`), enabled });
export const useGoalsProgress = (month: string, enabled = true) =>
  useQuery({ queryKey: ['goals-progress', month], queryFn: () => api<GoalsProgress>(`/reports/goals?month=${month}`), placeholderData: keepPreviousData, staleTime: 60_000, refetchOnWindowFocus: false, enabled });
export const useSaveGoals = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ month, ...b }: { month: string; default: GoalTarget | null; goals: (GoalTarget & { userId: string })[] }) => api<MonthGoals>(`/sales-goals/${month}`, { method: 'PUT', body: JSON.stringify(b) }),
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ['sales-goals', v.month] }); qc.invalidateQueries({ queryKey: ['goals-progress', v.month] }); },
  });
};

// ---- Relatórios: detalhamento de vendas ----
export interface SaleDetailsFilters { startDate: string; endDate: string; userId?: string; tagIds?: string; search?: string; page: number; pageSize?: number }
export interface SaleDetailsRow {
  id: string;
  closedAt: string;
  amount: number;
  conversationId: string;
  contact: { id: string; name: string | null; phone: string; phoneFormatted: string };
  user: { id: string; name: string | null } | null;
  items: { description: string; value: number }[];
  notes: string | null;
}
export interface SaleDetails {
  page: number;
  pageSize: number;
  total: number;
  /** resumo do filtro inteiro, não só da página */
  summary: { count: number; revenue: number; avgTicket: number | null; itemsSold: number };
  agents: { id: string; name: string }[];
  rows: SaleDetailsRow[];
}
export const useSaleDetails = (f: SaleDetailsFilters) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
  return useQuery({ queryKey: ['sale-details', qs.toString()], queryFn: () => api<SaleDetails>(`/reports/sales/details?${qs}`), placeholderData: keepPreviousData, staleTime: 60_000, refetchOnWindowFocus: false });
};

// ---- Auditoria de atendimentos (cada encerramento do período) ----
export interface AttendanceFilters { startDate: string; endDate: string; outcome?: 'won' | 'lost' | 'none'; tagIds?: string; closeReasonId?: string; reason?: string; userId?: string; search?: string; page: number; pageSize?: number }
export interface AttendanceRow {
  id: string;
  closedAt: string;
  /** encerramento anterior da conversa (null = desde o começo): a janela das mensagens */
  startedAt: string | null;
  conversationId: string;
  outcome: 'won' | 'lost' | 'none' | null;
  value: number | null;
  /** tags do atendimento (congeladas no encerramento) */
  tags: { id: string; name: string; color: string }[];
  /** motivo do encerramento (lista da empresa) */
  closeReason: { id: string; name: string; color: string } | null;
  /** motivo em texto de encerramento antigo, sem cadastro */
  reason: string | null;
  /** etapa do Kanban em que o atendimento estava */
  stage: { id: string; name: string; color: string } | null;
  messages: number;
  contact: { id: string; name: string | null; phone: string; phoneFormatted: string };
  user: { id: string; name: string } | null;
  /** encerrado pela automação: de quem era a conversa (entra no filtro de consultor dele) */
  owner: { id: string; name: string | null } | null;
}
export interface Attendances {
  page: number;
  pageSize: number;
  total: number;
  summary: { count: number; won: number; lost: number };
  agents: { id: string; name: string }[];
  rows: AttendanceRow[];
}
export const useAttendances = (f: AttendanceFilters) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
  return useQuery({ queryKey: ['attendances', qs.toString()], queryFn: () => api<Attendances>(`/reports/attendances?${qs}`), placeholderData: keepPreviousData, staleTime: 60_000, refetchOnWindowFocus: false });
};
/** mensagens de UM atendimento: depois do encerramento anterior até este */
export const useAttendanceMessages = (a: { conversationId: string; startedAt: string | null; closedAt: string } | null) =>
  useQuery({
    queryKey: ['attendance-messages', a?.conversationId, a?.startedAt, a?.closedAt],
    enabled: !!a,
    queryFn: () => {
      const qs = new URLSearchParams({ until: a!.closedAt, ...(a!.startedAt && { after: a!.startedAt }) });
      return api<Message[]>(`/conversations/${a!.conversationId}/messages?${qs}`);
    },
  });
