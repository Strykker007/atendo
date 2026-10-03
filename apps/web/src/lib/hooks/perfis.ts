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
export interface AccessProfile { id: string; name: string; description: string | null; permissions: Permission[]; isSystem: boolean; _count: { users: number } }
export const useProfiles = () => useQuery({ queryKey: ['profiles'], queryFn: () => api<AccessProfile[]>('/profiles') });
const invProfiles = (qc: ReturnType<typeof useQueryClient>) => () => { qc.invalidateQueries({ queryKey: ['profiles'] }); qc.invalidateQueries({ queryKey: ['agents'] }); qc.invalidateQueries({ queryKey: ['me'] }); };
export const useCreateProfile = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { name: string; description?: string; permissions: Permission[] }) => api<AccessProfile>('/profiles', { method: 'POST', body: JSON.stringify(b) }), onSuccess: invProfiles(qc) }); };
export const useUpdateProfile = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; description?: string; permissions?: Permission[] }) => api<AccessProfile>(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: invProfiles(qc) }); };
export const useDeleteProfile = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/profiles/${id}`, { method: 'DELETE' }), onSuccess: invProfiles(qc) }); };
