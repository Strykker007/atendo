'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TicketContextMessage, TicketEventType, TicketField, TicketPriority, TicketSource, TicketStatus, TicketType } from '@atendo/shared';
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
  /** só na lista: me diz respeito e mudou depois que abri (docs/tickets.md#não-lidos) */
  unread?: boolean;
  /** tipo (docs/tickets.md#tipos-de-ticket) */
  type: { id: string; name: string; color: string } | null;
  /** campos do tipo (rótulos) e o que foi preenchido, por chave */
  typeFields: TicketField[];
  fields: Record<string, string>;
  /** de onde veio: painel, conversa, fluxo automático, agente de IA */
  source: TicketSource;
  /** reclamante (docs/tickets.md#reclamante): o contato que pediu */
  requester: { id: string; name: string | null; phone: string } | null;
  /** avisa o reclamante no WhatsApp na abertura e no encerramento */
  notifyRequester: boolean;
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
  /** tipos da empresa (inclusive desativados — o formulário mostra só os ativos) */
  types: TicketType[];
  /** modelos do aviso ao reclamante (já com o padrão quando a empresa não escreveu o dela) */
  notices: { opened: string; closed: string; openedCustom: boolean; closedCustom: boolean };
}
/**
 * `scope` to_pick = aberto sem responsável que posso pegar · `due` overdue/today = prazo vencido/vence hoje ·
 * `responsibleId` none = sem responsável · `sort` due/priority/created (padrão: última mudança)
 */
export interface TicketQuery { scope?: 'mine' | 'department' | 'created' | 'to_pick' | 'all'; due?: 'overdue' | 'today' | ''; responsibleId?: string; sort?: 'updated' | 'due' | 'priority' | 'created'; pageSize?: number; status?: TicketStatus | 'active' | ''; priority?: TicketPriority | ''; departmentId?: string; typeId?: string; source?: TicketSource | ''; search?: string; page?: number }

const qs = (q: object) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
  return p.toString();
};

export const useTickets = (q: TicketQuery, enabled = true) => useQuery({ queryKey: ['tickets', q], enabled, queryFn: () => api<{ items: TicketRow[]; total: number; page: number; pageSize: number }>(`/tickets?${qs(q)}`), placeholderData: keepPreviousData });
export const useTicketsSummary = (enabled = true) => useQuery({ queryKey: ['tickets-summary'], enabled, queryFn: () => api<{ mine: number; department: number; onHold: number; holdExpired: number; overdue: number; /** vence hoje e ainda não venceu (aberto/em andamento) */ dueToday: number; /** abertos sem responsável no meu setor: alguém precisa pegar */ toPick: number; /** ativos que me dizem respeito e mudaram depois que abri — o número do menu */ unread?: number }>('/tickets/summary'), refetchInterval: 120_000 });
export const useTicket = (id: string | null) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['ticket', id],
    enabled: !!id,
    // abrir marca como lido na API: o número do menu e o ponto da lista apagam na hora
    queryFn: async () => {
      const t = await api<TicketDetail>(`/tickets/${id}`);
      qc.invalidateQueries({ queryKey: ['tickets-summary'] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      return t;
    },
  });
};
export const useConversationTickets = (conversationId: string | null, enabled = true) =>
  useQuery({ queryKey: ['tickets', 'conversation', conversationId], enabled: enabled && !!conversationId, queryFn: () => api<ConversationTicket[]>(`/tickets/conversation/${conversationId}`) });
export const useTicketOptions = (enabled = true) => useQuery({ queryKey: ['ticket-options'], enabled, queryFn: () => api<TicketOptions>('/tickets/options'), staleTime: 60_000 });

/** Toda escrita devolve o ticket atualizado: grava no cache do detalhe e recarrega a lista. */
export const useTicketWrite = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) =>
      api<TicketDetail | TicketOptions | TicketType[] | { left: true }>(`/tickets${path}`, { method, ...(body !== undefined && { body: JSON.stringify(body) }) }),
    onSuccess: (r) => {
      if (r && 'events' in r) qc.setQueryData(['ticket', r.id], r);
      if (r && 'holdReasons' in r) qc.setQueryData(['ticket-options'], r);
      // tipos mudaram: o formulário e os filtros leem das opções
      if (Array.isArray(r)) qc.invalidateQueries({ queryKey: ['ticket-options'] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['tickets-summary'] });
    },
  });
};

/** Tipos de ticket no formato portável (docs/20-modelos-de-perfil.md). */
export const useExportTicketTypes = () =>
  useMutation({ mutationFn: () => api<{ bundle: { atendo: string; items: unknown[] }; warnings: string[] }>('/tickets/types/export') });

export const useImportTicketTypes = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (portable: unknown) => api<{ created: string[]; skipped: string[] }>('/tickets/types/import', { method: 'POST', body: JSON.stringify({ portable }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticket-options'] }),
  });
};

/** Ação em massa na seleção da lista; `failed` = os que a regra individual recusou (com o motivo). */
export interface TicketBulkInput { ids: string[]; action: 'assign' | 'status' | 'priority' | 'hold'; responsibleId?: string | null; status?: Exclude<TicketStatus, 'on_hold'>; priority?: TicketPriority; reasonId?: string; until?: string; note?: string }
export const useTicketBulk = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: TicketBulkInput) => api<{ ok: number; failed: { id: string; number: number | null; error: string }[] }>('/tickets/bulk', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets'] }); qc.invalidateQueries({ queryKey: ['tickets-summary'] }); qc.invalidateQueries({ queryKey: ['ticket'] }); },
  });
};

/** Relatório de tickets (docs/tickets.md#relatório). Tempos em minutos; mediana = o tempo típico. */
export interface TicketReportRow { key: string; name: string; created: number; resolved: number; active: number; overdue: number; medianFirstResponseMin: number | null; medianResolutionMin: number | null; onTimePct: number | null }
export interface TicketReport {
  totals: {
    created: number; resolved: number; canceled: number; active: number; overdue: number; toPick: number; onHold: number;
    avgFirstResponseMin: number | null; medianFirstResponseMin: number | null; avgResolutionMin: number | null; medianResolutionMin: number | null;
    medianNetResolutionMin: number | null; onTimePct: number | null; resolvedWithDue: number;
  };
  series: { day: string; created: number; resolved: number }[];
  byDepartment: TicketReportRow[]; byType: TicketReportRow[]; byPriority: TicketReportRow[]; bySource: TicketReportRow[]; byPerson: TicketReportRow[];
  holdByReason: { reason: string; count: number; totalMin: number; avgMin: number }[];
}
export const useTicketReport = (q: { startDate: string; endDate: string; departmentId?: string; typeId?: string }) =>
  useQuery({ queryKey: ['tickets-report', q], queryFn: () => api<TicketReport>(`/tickets/reports?${qs(q)}`), placeholderData: keepPreviousData });
