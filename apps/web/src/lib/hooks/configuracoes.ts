'use client';
/** Configurações do cliente. */
'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission, ScheduleConfig, WelcomeMessage, WelcomeMode } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';

// ---- Configurações do cliente (fuso, atendimento ativo, fluxos padrão, boas-vindas) ----
export interface TenantSettings {
  tenantId: string; timezone: string; attendanceActive: boolean;
  welcomeFlowId: string | null; closedFlowId: string | null; onCloseFlowId: string | null; defaultFlowId: string | null; defaultFlowInactivityHours: number;
  /** fluxo padrão por desfecho do encerramento (pré-selecionado no modal; ganha de `onCloseFlowId`) */
  wonFlowId: string | null; lostFlowId: string | null; noneFlowId: string | null;
  welcomeMessages: WelcomeMessage[]; welcomeMode: WelcomeMode; welcomeEnabled: boolean;
  /** respostas rápidas: segundos de contagem antes de enviar (0 = na hora) */
  quickReplyDelaySec: number;
  /** motivos de perda sugeridos no encerramento "Não comprou" */
  lossReasons: string[];
  /** quadro padrão, agora */
  isOpenNow: boolean; currentBand: string; nextOpenLabel: string;
}
export type SettingsPatch = Partial<Pick<TenantSettings, 'timezone' | 'attendanceActive' | 'welcomeFlowId' | 'closedFlowId' | 'onCloseFlowId' | 'wonFlowId' | 'lostFlowId' | 'noneFlowId' | 'defaultFlowId' | 'defaultFlowInactivityHours' | 'welcomeMessages' | 'welcomeMode' | 'welcomeEnabled' | 'quickReplyDelaySec' | 'lossReasons'>>;
export const useTenantSettings = () => useQuery({ queryKey: ['tenant-settings'], queryFn: () => api<TenantSettings>('/settings') });
const invSettings = (qc: ReturnType<typeof useQueryClient>) => () => { qc.invalidateQueries({ queryKey: ['tenant-settings'] }); qc.invalidateQueries({ queryKey: ['schedules'] }); };
export const useUpdateTenantSettings = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: SettingsPatch) => api('/settings', { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: invSettings(qc) }); };

// ---- Quadros de horários (docs/horarios.md) ----
export interface BusinessSchedule { id: string; name: string; timezone: string; isDefault: boolean; config: ScheduleConfig; numbers: { id: string; label: string; phone: string }[] }
export const useSchedules = () => useQuery({ queryKey: ['schedules'], queryFn: () => api<BusinessSchedule[]>('/settings/schedules') });
export const useCreateSchedule = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { name: string; timezone?: string; copyFromId?: string }) => api<BusinessSchedule>('/settings/schedules', { method: 'POST', body: JSON.stringify(b) }), onSuccess: invSettings(qc) }); };
/** Salvar o quadro devolve `renamedConditions`: regras de "Faixa de horário atual" atualizadas nos fluxos por causa de faixa renomeada. */
export const useUpdateSchedule = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; timezone?: string; config?: ScheduleConfig }) => api<BusinessSchedule & { renamedConditions: number }>(`/settings/schedules/${id}`, { method: 'PUT', body: JSON.stringify(b) }), onSuccess: (r) => { invSettings(qc)(); if (r.renamedConditions) { qc.invalidateQueries({ queryKey: ['flows'] }); qc.invalidateQueries({ queryKey: ['flow'] }); } } }); };
export const useDeleteSchedule = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/settings/schedules/${id}`, { method: 'DELETE' }), onSuccess: () => { invSettings(qc)(); qc.invalidateQueries({ queryKey: ['numbers'] }); } }); };
export const useSetDefaultSchedule = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/settings/schedules/${id}/default`, { method: 'POST' }), onSuccess: invSettings(qc) }); };
export const useSetNumberSchedule = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ numberId, scheduleId }: { numberId: string; scheduleId: string | null }) => api(`/settings/numbers/${numberId}/schedule`, { method: 'PUT', body: JSON.stringify({ scheduleId }) }), onSuccess: () => { invSettings(qc)(); qc.invalidateQueries({ queryKey: ['numbers'] }); } }); };
