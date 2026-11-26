'use client';
/**
 * Feedback de atendimento (docs/feedback-de-atendimento.md) e o que o atendente precisa ver ao
 * entrar (`/reviews/attention`: feedbacks pendentes + notas internas não lidas).
 */
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AttendanceReview, CreateReviewInput, ReviewSettings } from '@atendo/shared';
import { api } from '../api';
import type { Message } from './core';

export interface Attention {
  reviews: { pending: number; blocking: number; items: AttendanceReview[] };
  notes: { conversationId: string; byName: string; text: string; contactName: string }[];
}

const inv = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['reviews'] });
  qc.invalidateQueries({ queryKey: ['attention'] });
};

export const useAttention = (enabled = true) =>
  useQuery({ queryKey: ['attention'], queryFn: () => api<Attention>('/reviews/attention'), enabled, staleTime: 60_000, refetchInterval: 5 * 60_000 });

export const useMyReviews = () => useQuery({ queryKey: ['reviews', 'mine'], queryFn: () => api<AttendanceReview[]>('/reviews/mine') });

export const useTeamReviews = (f: { agentId?: string; status?: 'pending' | 'overdue' | 'acknowledged' | 'all'; reviewer?: 'me'; kind?: string; from?: string; to?: string; search?: string }, enabled = true) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v && v !== 'all') as [string, string][]).toString();
  return useQuery({ queryKey: ['reviews', 'team', qs], queryFn: () => api<AttendanceReview[]>(`/reviews${qs ? `?${qs}` : ''}`), enabled, placeholderData: keepPreviousData });
};

export const useReview = (id: string | null) =>
  useQuery({ queryKey: ['reviews', 'one', id], queryFn: () => api<AttendanceReview>(`/reviews/${id}`), enabled: !!id });

export const useReviewMessages = (id: string | null) =>
  useQuery({ queryKey: ['reviews', 'messages', id], queryFn: () => api<Message[]>(`/reviews/${id}/messages`), enabled: !!id, staleTime: 5 * 60_000 });

/** Quantos feedbacks cada linha da auditoria já tem ({ [closeEventId]: n }). */
export const useReviewsByAttendance = (ids: string[], enabled: boolean) =>
  useQuery({
    queryKey: ['reviews', 'by-attendance', ids.join(',')],
    queryFn: () => api<Record<string, number>>(`/reviews/by-attendance?ids=${ids.join(',')}`),
    enabled: enabled && ids.length > 0,
  });

export function useCreateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateReviewInput & { agentId?: string }) => api<AttendanceReview>('/reviews', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => inv(qc),
  });
}
export function useSeenReview() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api<AttendanceReview>(`/reviews/${id}/seen`, { method: 'POST' }), onSuccess: () => inv(qc) });
}
export function useAckReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reply }: { id: string; reply?: string }) => api<AttendanceReview>(`/reviews/${id}/ack`, { method: 'POST', body: JSON.stringify({ reply }) }),
    onSuccess: () => inv(qc),
  });
}
export function useDeleteReview() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/reviews/${id}`, { method: 'DELETE' }), onSuccess: () => inv(qc) });
}

export const useReviewSettings = () => useQuery({ queryKey: ['review-settings'], queryFn: () => api<ReviewSettings>('/reviews/settings') });
export function useSaveReviewSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: ReviewSettings) => api<ReviewSettings>('/reviews/settings', { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: (d) => qc.setQueryData(['review-settings'], d),
  });
}

/** Abriu a conversa: as notas internas para mim nela viram "lidas" (quem escreveu vê na hora). */
export function useReadNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => api<{ read: number }>(`/conversations/${conversationId}/notes/read`, { method: 'POST' }),
    onSuccess: (r) => { if (r.read) qc.invalidateQueries({ queryKey: ['attention'] }); },
  });
}

/**
 * Conversas com nota interna para mim ainda não lida → selo chamativo na lista e no Kanban
 * (docs/notas-internas.md#leitura). Sai sozinho ao abrir a conversa (`useReadNotes`).
 */
export function usePendingNotes(): Map<string, { count: number; byName: string }> {
  // só lê o cache: quem busca é o shell (AttentionGate) e o menu, já com a regra de quem é cliente
  const att = useQuery({ queryKey: ['attention'], queryFn: () => api<Attention>('/reviews/attention'), staleTime: 60_000, enabled: false }).data?.notes ?? [];
  const m = new Map<string, { count: number; byName: string }>();
  for (const n of att) {
    const x = m.get(n.conversationId);
    m.set(n.conversationId, { count: (x?.count ?? 0) + 1, byName: x?.byName ?? n.byName });
  }
  return m;
}
