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
  return useMutation({ mutationFn: (b: { name: string; color: string }) => api<Tag>('/tags', { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }) });
};
export const useUpdateTag = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; color?: string }) => api<Tag>(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }) });
};
export const useDeleteTag = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/tags/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }) });
};
