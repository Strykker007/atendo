'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

// ---- Donos do sistema (docs/donos-do-sistema.md) ----
export type OwnerRole = 'super_admin' | 'tenant_admin' | 'manager' | 'agent';
export interface SystemOwner {
  id: string; name: string; email: string; role: OwnerRole; isActive: boolean; isSystemOwner: boolean;
  invitedAt: string | null; passwordSetAt: string | null; lastLoginAt: string | null;
  tenant: { id: string; name: string } | null;
  /** vínculos: a mesma pessoa em outras empresas (docs/multiempresa.md) */
  memberships: { id: string; role: Exclude<OwnerRole, 'super_admin'>; isSystemOwner: boolean; tenant: { id: string; name: string } | null }[];
}
export interface OwnerCandidate { id: string; name: string; email: string; role: OwnerRole; tenant: { id: string; name: string } | null }

export const useSystemOwners = () => useQuery({ queryKey: ['system-owners'], queryFn: () => api<SystemOwner[]>('/super-admin/owners') });
export const useOwnerCandidates = (q: string) =>
  useQuery({ queryKey: ['system-owners', 'candidates', q], enabled: q.length >= 2, queryFn: () => api<OwnerCandidate[]>(`/super-admin/owners/candidates?q=${encodeURIComponent(q)}`) });

function useOwnersMutation<T, R>(fn: (b: T) => Promise<R>) {
  const qc = useQueryClient();
  // vínculo novo/desfeito muda também o seletor "Minhas empresas"
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: ['system-owners'] }); qc.invalidateQueries({ queryKey: ['memberships'] }); } });
}
export const usePromoteOwner = () => useOwnersMutation((userId: string) => api<SystemOwner>('/super-admin/owners', { method: 'POST', body: JSON.stringify({ userId }) }));
export const useInviteOwner = () =>
  useOwnersMutation((b: { name: string; email: string }) => api<SystemOwner & { inviteLink: string; emailSent: boolean }>('/super-admin/owners/invite', { method: 'POST', body: JSON.stringify(b) }));
export const useOwnerInviteLink = () => useOwnersMutation((id: string) => api<{ link: string }>(`/super-admin/owners/${id}/invite-link`, { method: 'POST' }));
export const useLinkOwner = () =>
  useOwnersMutation(({ id, ...b }: { id: string; tenantId: string; role: 'tenant_admin' | 'manager' | 'agent'; owner: boolean }) => api<SystemOwner>(`/super-admin/owners/${id}/link`, { method: 'POST', body: JSON.stringify(b) }));
export const useUnlinkOwner = () =>
  useOwnersMutation(({ id, userId }: { id: string; userId: string }) => api<SystemOwner>(`/super-admin/owners/${id}/link/${userId}`, { method: 'DELETE' }));

// ---- Minhas empresas (docs/multiempresa.md) ----
export interface Membership { userId: string; tenantId: string | null; tenantName: string | null; role: OwnerRole; systemOwner: boolean; current: boolean }
export const useMemberships = () => useQuery({ queryKey: ['memberships'], queryFn: () => api<Membership[]>('/auth/memberships'), staleTime: 60_000 });
export const useRemoveOwner = () => useOwnersMutation((id: string) => api<{ ok: true }>(`/super-admin/owners/${id}`, { method: 'DELETE' }));
