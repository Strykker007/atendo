'use client';
/** Equipe e permissões. */
'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';

// ---- Equipe ----
export type Role = 'tenant_admin' | 'manager' | 'agent' | 'super_admin';
export interface Agent { id: string; name: string; email: string; role: Role; isActive: boolean; lastLoginAt: string | null; invitedAt?: string | null; passwordSetAt?: string | null; profile?: { id: string; name: string } | null; numbers?: { numberId: string }[]; departments?: { departmentId: string }[] }
export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => api<Agent[]>('/tenants/me/agents') });
export const useCreateAgent = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { name: string; email: string; password?: string; role?: 'agent' | 'manager' }) => api<Agent & { invited?: boolean; inviteLink?: string; emailSent?: boolean }>('/tenants/me/agents', { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); qc.invalidateQueries({ queryKey: ['usage'] }); } });
};
export const useResendInvite = () => useMutation({ mutationFn: (id: string) => api<{ ok: boolean; emailSent: boolean; inviteLink: string }>(`/tenants/me/agents/${id}/resend-invite`, { method: 'POST' }) });
/** Link de convite para mandar por WhatsApp — não depende de e-mail configurado. */
export const useInviteLink = () => useMutation({ mutationFn: (id: string) => api<{ link: string; expiresInHours: number }>(`/tenants/me/agents/${id}/invite-link`, { method: 'POST' }) });
export const useChangePassword = () => useMutation({ mutationFn: (b: { current: string; password: string }) => api('/auth/change-password', { method: 'POST', body: JSON.stringify(b) }) });

export const useUpdateAgent = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; isActive?: boolean; password?: string; profileId?: string; numberIds?: string[] }) => api(`/tenants/me/agents/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); qc.invalidateQueries({ queryKey: ['usage'] }); } });
};
