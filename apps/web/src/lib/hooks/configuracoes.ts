'use client';
/** Configurações do cliente. */
'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';

// ---- Configurações do cliente (fuso, expediente) ----
export interface BusinessHour { weekday: number; start: string; end: string }
export interface TenantSettings {
  tenantId: string; timezone: string; attendanceActive: boolean; outsideHoursText: string | null;
  welcomeFlowId: string | null; closedFlowId: string | null; onCloseFlowId: string | null; defaultFlowId: string | null; defaultFlowInactivityHours: number;
  hours: (BusinessHour & { id: string })[]; isOpenNow: boolean; suggested: BusinessHour[];
}
export const useTenantSettings = () => useQuery({ queryKey: ['tenant-settings'], queryFn: () => api<TenantSettings>('/settings') });
const invSettings = (qc: ReturnType<typeof useQueryClient>) => () => qc.invalidateQueries({ queryKey: ['tenant-settings'] });
export const useUpdateTenantSettings = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { timezone?: string; attendanceActive?: boolean; outsideHoursText?: string; welcomeFlowId?: string | null; closedFlowId?: string | null; onCloseFlowId?: string | null; defaultFlowId?: string | null; defaultFlowInactivityHours?: number }) => api('/settings', { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: invSettings(qc) }); };
export const useSetBusinessHours = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (hours: BusinessHour[]) => api('/settings/business-hours', { method: 'PUT', body: JSON.stringify({ hours }) }), onSuccess: invSettings(qc) }); };
