'use client';
/** Etiquetas. */
'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';
import { Tag } from './core';

// ---- Tags (admin) ----
export const useCreateTag = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { name: string; color: string; isKanban?: boolean; showOnWon?: boolean; showOnLost?: boolean }) => api<Tag>('/tags', { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }) });
};
export const useUpdateTag = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; color?: string; isKanban?: boolean; showOnWon?: boolean; showOnLost?: boolean }) => api<Tag>(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['tags'] }); qc.invalidateQueries({ queryKey: ['kanban'] }); } });
};
export const useDeleteTag = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/tags/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }) });
};

// ---- Tags em massa (selecionar várias na tela de Tags) ----
type TagFlags = { color?: string; isKanban?: boolean; showOnWon?: boolean; showOnLost?: boolean };
const refreshTags = (qc: ReturnType<typeof useQueryClient>) => { qc.invalidateQueries({ queryKey: ['tags'] }); qc.invalidateQueries({ queryKey: ['kanban'] }); };
/** uma tag por item, cada uma com a sua cor (sem cor = `color`); repetida ou já existente é ignorada (`skipped`) */
export const useBulkCreateTags = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { items: { name: string; color?: string }[] } & TagFlags) => api<{ created: number; skipped: number }>('/tags/bulk', { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => refreshTags(qc) });
};
export const useBulkUpdateTags = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { ids: string[] } & TagFlags) => api<{ updated: number }>('/tags/bulk', { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: () => refreshTags(qc) });
};
export const useBulkDeleteTags = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (ids: string[]) => api<{ deleted: number }>('/tags/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }), onSuccess: () => refreshTags(qc) });
};

/** opostas de uma tag (substitui a lista; o par vale nos dois sentidos) */
export const useSetTagConflicts = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ids }: { id: string; ids: string[] }) => api<{ conflictIds: string[] }>(`/tags/${id}/conflicts`, { method: 'PUT', body: JSON.stringify({ ids }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }) });
};

/** reordenar arrastando: a lista inteira na ordem nova (é também a ordem das colunas do Kanban) */
export const useReorderTags = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api('/tags/order', { method: 'PATCH', body: JSON.stringify({ ids }) }),
    // a lista já aparece na ordem nova; se a API recusar, o refetch desfaz
    onMutate: (ids) => qc.setQueryData<Tag[]>(['tags'], (old) => old && ids.map((id) => old.find((t) => t.id === id)).filter((t): t is Tag => !!t)),
    onSettled: () => refreshTags(qc),
  });
};
