'use client';
/** Relatórios. */
'use client';
import { keepPreviousData, useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';
import { ConversationOrigin } from './core';

// ---- Relatórios ----
export type ReportMetric = 'conversations' | 'messages_in' | 'messages_out' | 'avg_first_response_min' | 'revenue' | 'won' | 'lost' | 'win_rate';
export type ReportGroup = 'day' | 'week' | 'month' | 'tag' | 'status' | 'number' | 'agent' | 'origin' | 'campaign';
export interface ReportDefinition {
  metric: ReportMetric;
  groupBy: ReportGroup;
  from: string; // YYYY-MM-DD
  to: string;   // exclusivo
  filters: { tagIds?: string[]; status?: ConversationStatus; numberId?: string; origin?: ConversationOrigin };
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

// ---- Relatórios: detalhamento de vendas ----
export interface SaleDetailsFilters { startDate: string; endDate: string; userId?: string; search?: string; page: number; pageSize?: number }
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
  return useQuery({ queryKey: ['sale-details', qs.toString()], queryFn: () => api<SaleDetails>(`/reports/sales/details?${qs}`), placeholderData: keepPreviousData });
};
