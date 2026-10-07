'use client';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { api } from '../api';

// ---- Avisos globais do dono do sistema (docs/avisos.md) ----
export type SystemNoticeType = 'INFO' | 'WARNING' | 'CRITICAL';
export interface SystemNotice { id: string; title: string; message: string; type: SystemNoticeType; active: boolean; createdAt: string }

/** Avisos ativos (sino). O socket mantém atualizado; o refetch periódico cobre desconexão. */
export const useActiveNotices = () => useQuery({ queryKey: ['notices', 'active'], staleTime: 60_000, refetchInterval: 5 * 60_000, queryFn: () => api<SystemNotice[]>('/notices/active') });

/** Todos os avisos (ativos e desativados) — tela do dono. */
export const useAdminNotices = () => useQuery({ queryKey: ['notices', 'admin'], queryFn: () => api<SystemNotice[]>('/super-admin/notices') });
export const useCreateNotice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { title: string; message: string; type: SystemNoticeType }) => api<SystemNotice>('/super-admin/notices', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notices'] }),
  });
};
export const useToggleNotice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api<SystemNotice>(`/super-admin/notices/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notices'] }),
  });
};

/** Fila do popup do topo: o socket empurra, o componente tira (X ou tempo). */
interface NoticePopupState { items: SystemNotice[]; push: (n: SystemNotice) => void; remove: (id: string) => void }
export const useNoticePopups = create<NoticePopupState>((set) => ({
  items: [],
  push: (n) => set((s) => (s.items.some((i) => i.id === n.id) ? s : { items: [...s.items, n] })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

/** Evento `system_notice` do socket: entra no sino na hora e abre o popup. */
export function receiveSystemNotice(qc: QueryClient, n: SystemNotice) {
  qc.setQueryData<SystemNotice[]>(['notices', 'active'], (old) => [n, ...(old ?? []).filter((x) => x.id !== n.id)]);
  useNoticePopups.getState().push(n);
}
