'use client';
/** Grupos restritos (opt-in estrito) — docs/grupos.md. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export interface WhatsAppGroup {
  id: string;
  numberId: string;
  jid: string;
  name: string;
  size: number;
  /** marcado pelo admin: pode receber transmissão */
  authorized: boolean;
  authorizedAt: string | null;
  updatedAt: string;
}

export const useGroups = (numberId?: string, enabled = true) =>
  useQuery({ queryKey: ['groups', numberId ?? ''], enabled, queryFn: () => api<WhatsAppGroup[]>(`/groups${numberId ? `?numberId=${numberId}` : ''}`) });

/** Busca os grupos do número no WhatsApp (grupo novo entra desmarcado). */
export const useSyncGroups = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (numberId: string) => api<WhatsAppGroup[]>('/groups/sync', { method: 'POST', body: JSON.stringify({ numberId }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }) });
};

export const useAuthorizeGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, authorized }: { id: string; authorized: boolean }) => api<WhatsAppGroup>(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ authorized }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
};
