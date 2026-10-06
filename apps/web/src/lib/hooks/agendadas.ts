'use client';
/** Mensagens agendadas da conversa (docs/agendamento-de-mensagens.md). */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export interface ScheduledMessage {
  id: string;
  conversationId: string;
  content: string;
  mediaKey: string | null;
  mediaType: 'image' | 'audio' | 'video' | 'document' | null;
  mediaName: string | null;
  scheduledFor: string;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  error: string | null;
  user: { id: string; name: string };
}

/** Pendentes e falhadas; o socket `scheduled_messages` invalida (ver numeros.ts). */
export const useScheduledMessages = (conversationId: string | null) =>
  useQuery({
    queryKey: ['scheduled-messages', conversationId],
    enabled: !!conversationId,
    queryFn: () => api<ScheduledMessage[]>(`/conversations/${conversationId}/scheduled-messages`),
  });

export const useScheduleMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, ...body }: { conversationId: string; content: string; scheduledFor: string; mediaKey?: string; mediaType?: string; mediaName?: string; mediaMime?: string }) =>
      api<ScheduledMessage>(`/conversations/${conversationId}/scheduled-messages`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['scheduled-messages', v.conversationId] }),
  });
};

export const useCancelScheduledMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, id }: { conversationId: string; id: string }) =>
      api(`/conversations/${conversationId}/scheduled-messages/${id}`, { method: 'DELETE' }),
    onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['scheduled-messages', v.conversationId] }),
  });
};
