'use client';
/** Relatórios. */
'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';
import { ConversationOrigin } from './core';

// ---- Relatórios ----
export type ReportMetric = 'conversations' | 'messages_in' | 'messages_out' | 'avg_first_response_min';
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
