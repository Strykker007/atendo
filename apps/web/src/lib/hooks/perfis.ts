'use client';
/** Perfis de acesso. */
'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';

// ---- Perfis de acesso ----
/** Acesso padrão do perfil, copiado para a pessoa (docs/18-perfis-de-acesso.md#acesso-padrão-do-perfil) */
export interface AccessTemplate { allNumbers: boolean; numberIds: string[]; defaultNumberIds: string[]; departmentIds: string[]; receiveAll: boolean; receiveNumberIds: string[] }
export interface AccessProfile { id: string; name: string; description: string | null; permissions: Permission[]; isSystem: boolean; systemRole?: 'tenant_admin' | 'manager' | 'agent' | null; accessTemplate?: AccessTemplate | null; _count: { users: number } }
type ProfileInput = { name: string; description?: string; permissions: Permission[]; accessTemplate?: AccessTemplate | null };
export const useProfiles = () => useQuery({ queryKey: ['profiles'], queryFn: () => api<AccessProfile[]>('/profiles') });
const invProfiles = (qc: ReturnType<typeof useQueryClient>) => () => { qc.invalidateQueries({ queryKey: ['profiles'] }); qc.invalidateQueries({ queryKey: ['agents'] }); qc.invalidateQueries({ queryKey: ['me'] }); };
export const useCreateProfile = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: ProfileInput) => api<AccessProfile>('/profiles', { method: 'POST', body: JSON.stringify(b) }), onSuccess: invProfiles(qc) }); };
export const useUpdateProfile = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: Partial<ProfileInput> & { id: string }) => api<AccessProfile>(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: invProfiles(qc) }); };
/** Reaplica o acesso padrão em todas as pessoas do perfil (sobrescreve os ajustes individuais). */
export const useApplyProfileAccess = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api<{ applied: number }>(`/tenants/me/profiles/${id}/apply-access`, { method: 'POST' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); qc.invalidateQueries({ queryKey: ['numbers'] }); qc.invalidateQueries({ queryKey: ['conversations'] }); } }); };
export const useDeleteProfile = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/profiles/${id}`, { method: 'DELETE' }), onSuccess: invProfiles(qc) }); };
