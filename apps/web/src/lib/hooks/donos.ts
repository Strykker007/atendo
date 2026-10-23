'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

// ---- Donos do sistema (docs/donos-do-sistema.md) ----
export type OwnerRole = 'super_admin' | 'tenant_admin' | 'manager' | 'agent';
export interface SystemOwner {
  id: string; name: string; email: string; role: OwnerRole; isActive: boolean; isSystemOwner: boolean;
  invitedAt: string | null; passwordSetAt: string | null; lastLoginAt: string | null;
  tenant: { id: string; name: string } | null;
}
export interface OwnerCandidate { id: string; name: string; email: string; role: OwnerRole; tenant: { id: string; name: string } | null }

export const useSystemOwners = () => useQuery({ queryKey: ['system-owners'], queryFn: () => api<SystemOwner[]>('/super-admin/owners') });
export const useOwnerCandidates = (q: string) =>
  useQuery({ queryKey: ['system-owners', 'candidates', q], enabled: q.length >= 2, queryFn: () => api<OwnerCandidate[]>(`/super-admin/owners/candidates?q=${encodeURIComponent(q)}`) });

function useOwnersMutation<T, R>(fn: (b: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['system-owners'] }) });
}
export const usePromoteOwner = () => useOwnersMutation((userId: string) => api<SystemOwner>('/super-admin/owners', { method: 'POST', body: JSON.stringify({ userId }) }));
export const useInviteOwner = () =>
  useOwnersMutation((b: { name: string; email: string }) => api<SystemOwner & { inviteLink: string; emailSent: boolean }>('/super-admin/owners/invite', { method: 'POST', body: JSON.stringify(b) }));
export const useOwnerInviteLink = () => useOwnersMutation((id: string) => api<{ link: string }>(`/super-admin/owners/${id}/invite-link`, { method: 'POST' }));
export const useLinkOwner = () =>
  useOwnersMutation(({ id, ...b }: { id: string; tenantId: string; role: 'tenant_admin' | 'manager' | 'agent' }) => api<SystemOwner>(`/super-admin/owners/${id}/link`, { method: 'POST', body: JSON.stringify(b) }));
export const useRemoveOwner = () => useOwnersMutation((id: string) => api<{ ok: true }>(`/super-admin/owners/${id}`, { method: 'DELETE' }));
