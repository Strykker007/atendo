'use client';
/** Fila de atendimento e pausa do atendente — docs/fila-de-atendimento.md. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentPause, AgentPauseReason, QueueStatus } from '@atendo/shared';
import { api } from '../api';

/** Situação da fila e a minha pausa. O socket (`queue`, `agent_pause`) recarrega na hora; 30 s é a rede de segurança. */
export const useQueueStatus = (enabled = true) =>
  useQuery({ queryKey: ['queue-status'], enabled, queryFn: () => api<QueueStatus>('/queue/status'), refetchInterval: 30_000, staleTime: 5_000 });

export const usePause = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { reason: AgentPauseReason; minutes?: number | null }) => api<{ pause: AgentPause }>('/queue/pause', { method: 'POST', body: JSON.stringify({ reason: b.reason, ...(b.minutes && { minutes: b.minutes }) }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue-status'] }),
  });
};

export const useResume = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api('/queue/resume', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['queue-status'] }) });
};

/** Gerente tira alguém da pausa. */
export const useResumeAgent = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/queue/agents/${id}/resume`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['queue-status'] }) });
};
