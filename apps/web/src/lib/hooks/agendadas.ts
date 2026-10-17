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

/** Linha da tela "Mensagens agendadas" (todas as conversas): com contato, número e conversa. */
export interface ScheduledMessageRow extends ScheduledMessage {
  sentAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  contact: { id: string; name: string | null; phone: string };
  conversation: { id: string; status: string; number: { id: string; label: string; color: string | null } | null };
}
export interface ScheduledFilters {
  status: 'pending' | 'failed' | 'sent' | 'cancelled' | 'all';
  userId: string;
  numberId: string;
  /** AAAA-MM-DD (dia local do navegador) */
  from: string;
  to: string;
  q: string;
  page: number;
}

/**
 * Todas as agendadas visíveis para quem está logado (as próprias, ou as de todos com
 * `conversations.view_all`), com filtros. Datas vão como início/fim do dia local.
 */
export const useAllScheduledMessages = (f: ScheduledFilters) =>
  useQuery({
    queryKey: ['scheduled-messages-all', f],
    queryFn: () => {
      const qs = new URLSearchParams({ status: f.status, page: String(f.page) });
      if (f.userId) qs.set('userId', f.userId);
      if (f.numberId) qs.set('numberId', f.numberId);
      if (f.q.trim()) qs.set('q', f.q.trim());
      if (f.from) qs.set('from', new Date(`${f.from}T00:00:00`).toISOString());
      if (f.to) qs.set('to', new Date(`${f.to}T23:59:59.999`).toISOString());
      return api<{ total: number; page: number; pageSize: number; rows: ScheduledMessageRow[] }>(`/scheduled-messages?${qs}`);
    },
    placeholderData: (prev) => prev,
  });

/** Cancelar pela tela geral (sem saber a conversa); atualiza a lista e a faixa da conversa. */
export const useCancelScheduledById = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (row: Pick<ScheduledMessageRow, 'id' | 'conversationId'>) => api(`/scheduled-messages/${row.id}`, { method: 'DELETE' }),
    onSuccess: (_, row) => {
      qc.invalidateQueries({ queryKey: ['scheduled-messages-all'] });
      qc.invalidateQueries({ queryKey: ['scheduled-messages', row.conversationId] });
    },
  });
};
