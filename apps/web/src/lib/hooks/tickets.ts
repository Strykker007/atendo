'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TicketContextMessage, TicketEventType, TicketPriority, TicketStatus } from '@atendo/shared';
import { api } from '../api';

/** Tickets internos (docs/tickets.md). */
export interface Pessoa { id: string; name: string }
export interface TicketRow {
  id: string; number: number; title: string; description: string | null; status: TicketStatus; priority: TicketPriority;
  department: { id: string; name: string; color: string } | null; conversationId: string | null; createdBy: Pessoa | null;
  createdAt: string; updatedAt: string; dueAt: string | null; resolvedAt: string | null;
  hold: { reason: Pessoa | null; note: string | null; until: string | null; since: string | null } | null;
  responsible: Pessoa | null;
  participants: (Pessoa & { role: 'responsible' | 'participant'; addedAt: string })[];
  comments: number;
  /** a pessoa atua (pode comentar, congelar, transferir, resolver) */
  canAct: boolean;
}
export interface TicketEvent { id: string; type: TicketEventType; body: string | null; data: Record<string, unknown> | null; actor: Pessoa | null; createdAt: string }
export interface TicketDetail extends TicketRow {
  /** mensagem de onde nasceu (o "momento" na conversa) */
  messageId: string | null;
  /** retrato das mensagens até a abertura — fica mesmo se a conversa sumir */
  context: TicketContextMessage[] | null;
  /** `canOpen` = a pessoa pode abrir a conversa (número e setor) */
  conversation: { id: string; canOpen: boolean; contact: { name: string | null; phone: string } } | null;
  events: TicketEvent[];
}
/** Selo no topo da conversa: os tickets que nasceram dela. */
export interface ConversationTicket { id: string; number: number; title: string; status: TicketStatus; messageId: string | null; createdAt: string }
export interface TicketOptions {
  users: (Pessoa & { departmentIds: string[] })[];
  departments: { id: string; name: string; color: string }[];
  holdReasons: { id: string; name: string; isActive: boolean }[];
}
export interface TicketQuery { scope?: 'mine' | 'department' | 'created' | 'all'; status?: TicketStatus | 'active' | ''; priority?: TicketPriority | ''; departmentId?: string; search?: string; page?: number }

const qs = (q: TicketQuery) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
  return p.toString();
};

export const useTickets = (q: TicketQuery) => useQuery({ queryKey: ['tickets', q], queryFn: () => api<{ items: TicketRow[]; total: number; page: number; pageSize: number }>(`/tickets?${qs(q)}`), placeholderData: keepPreviousData });
export const useTicketsSummary = (enabled = true) => useQuery({ queryKey: ['tickets-summary'], enabled, queryFn: () => api<{ mine: number; department: number; onHold: number; holdExpired: number; overdue: number }>('/tickets/summary'), refetchInterval: 120_000 });
export const useTicket = (id: string | null) => useQuery({ queryKey: ['ticket', id], enabled: !!id, queryFn: () => api<TicketDetail>(`/tickets/${id}`) });
export const useConversationTickets = (conversationId: string | null, enabled = true) =>
  useQuery({ queryKey: ['tickets', 'conversation', conversationId], enabled: enabled && !!conversationId, queryFn: () => api<ConversationTicket[]>(`/tickets/conversation/${conversationId}`) });
export const useTicketOptions = (enabled = true) => useQuery({ queryKey: ['ticket-options'], enabled, queryFn: () => api<TicketOptions>('/tickets/options'), staleTime: 60_000 });

/** Toda escrita devolve o ticket atualizado: grava no cache do detalhe e recarrega a lista. */
export const useTicketWrite = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) =>
      api<TicketDetail | TicketOptions | { left: true }>(`/tickets${path}`, { method, ...(body !== undefined && { body: JSON.stringify(body) }) }),
    onSuccess: (r) => {
      if (r && 'events' in r) qc.setQueryData(['ticket', r.id], r);
      if (r && 'holdReasons' in r) qc.setQueryData(['ticket-options'], r);
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['tickets-summary'] });
    },
  });
};
