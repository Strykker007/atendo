'use client';
/** Chaves Pix da empresa — enviadas pelo painel do chat como cartão "Copiar chave Pix" (docs/07-api.md). */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PixKeyType } from '@atendo/shared';
import { api } from '../api';

export interface PixKey { id: string; title: string; keyType: PixKeyType; key: string; holderName: string; position: number }
type Body = { title: string; keyType: PixKeyType; key: string; holderName?: string };

const KEY = ['pix-keys'];
const BASE = '/tenants/me/pix-keys';

export const usePixKeys = () => useQuery({ queryKey: KEY, queryFn: () => api<PixKey[]>(BASE), staleTime: 60_000 });
export const useCreatePixKey = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: Body) => api<PixKey>(BASE, { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
};
export const useUpdatePixKey = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...b }: Body & { id: string }) => api<PixKey>(`${BASE}/${id}`, { method: 'PUT', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
};
export const useDeletePixKey = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`${BASE}/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
};
