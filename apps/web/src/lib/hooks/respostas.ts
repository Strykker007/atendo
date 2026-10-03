'use client';
/** Respostas rápidas e pastas. */
'use client';
import type { Agent } from './equipe';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';

// ---- Respostas rápidas (admin) ----
const invQR = (qc: ReturnType<typeof useQueryClient>) => () => qc.invalidateQueries({ queryKey: ['quick-replies'] });
export const useCreateFolder = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { name: string }) => api('/quick-replies/folders', { method: 'POST', body: JSON.stringify(b) }), onSuccess: invQR(qc) }); };
export const useUpdateFolder = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; position?: number }) => api(`/quick-replies/folders/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: invQR(qc) }); };
export const useDeleteFolder = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/quick-replies/folders/${id}`, { method: 'DELETE' }), onSuccess: invQR(qc) }); };
export const useCreateReply = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { folderId: string; title: string; body: string; mediaKey?: string | null; mediaType?: string | null; mediaName?: string | null; mediaMime?: string | null }) => api('/quick-replies', { method: 'POST', body: JSON.stringify(b) }), onSuccess: invQR(qc) }); };
export const useUpdateReply = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: { id: string; title?: string; body?: string; mediaKey?: string | null; mediaType?: string | null; mediaName?: string | null; mediaMime?: string | null }) => api(`/quick-replies/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: invQR(qc) }); };
export const useDeleteReply = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/quick-replies/${id}`, { method: 'DELETE' }), onSuccess: invQR(qc) }); };

/** Usuário logado (papel, tenant, permissões) — para esconder o que ele não pode fazer. */
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<{ id: string; tenantId: string | null; role: Agent['role']; email: string; name: string; impersonatorId?: string; permissions?: Permission[] }>('/auth/me'), staleTime: Infinity });

/**
 * O usuário pode fazer isto? Esconder na tela é conveniência — quem autoriza de verdade é a
 * API, que checa de novo a cada requisição.
 */
export const useCan = (permission: Permission) => usePermissions().includes(permission);

/**
 * Tudo que o usuário pode. O dono do sistema recebe o catálogo inteiro — mesma regra do
 * servidor (`permissionsOf`), para a tela não divergir de quem autoriza.
 */
export const usePermissions = (): Permission[] => {
  const me = useMe();
  if (!me.data) return [];
  if (me.data.role === 'super_admin') return [...ALL_PERMISSIONS];
  return me.data.permissions ?? [];
};
