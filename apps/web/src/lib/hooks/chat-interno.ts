'use client';
/** Chat interno da equipe e canal de suporte do sistema — docs/chat-interno.md. */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { api } from '../api';

export interface InternalUser { id: string; name: string; email: string; /** painel aberto agora */ online: boolean }
export interface InternalChatMember { id: string; name: string; active: boolean }
/** Atendimento no canal de suporte (docs/chat-interno.md#fila-de-suporte). */
export interface SupportTicket {
  id: string;
  /** #123 — sequência global */
  number: number;
  status: 'open' | 'in_progress' | 'resolved';
  assigneeId: string | null;
  assigneeName: string | null;
  openedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  /** lado do cliente: posição na fila (1 = o próximo); null fora da fila */
  position?: number | null;
}
export interface InternalChat {
  id: string;
  isGroup: boolean;
  /** canal com o suporte do sistema (um por cliente); no lado do dono, `name` = nome do cliente */
  isSupport?: boolean;
  /** chat da equipe do suporte (entre super_admins); `isGroup` = canal da equipe inteira */
  isStaff?: boolean;
  tenantId?: string;
  /** grupo: o nome dado; direta: o outro membro (na auditoria, os dois) */
  name: string;
  members: InternalChatMember[];
  /** quem criou (grupo: gerencia membros, nome e pode apagar) */
  createdById: string | null;
  /** grupo apagado (só aparece na auditoria) */
  deletedAt?: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread?: number;
  /** canal de suporte: atendimento ativo (ou o último, na aba Encerrados); null = nenhum */
  ticket?: SupportTicket | null;
  /** só na auditoria */
  messages?: number;
  createdAt?: string;
}
export interface InternalMessage {
  id: string; chatId: string; authorId: string | null; authorName: string; text: string; createdAt: string;
  /** aviso do sistema ("Ana adicionou Bruno") */
  system?: boolean;
  /** escrita pelo suporte do sistema */
  fromSupport?: boolean;
  replyToId?: string | null;
  /** trecho da mensagem respondida; null = ela não existe mais */
  replyTo?: { id: string; authorId: string | null; authorName: string; text: string; system: boolean } | null;
}

const PAGE = 50;

/**
 * De que lado da conversa a tela está: `team` = equipe do cliente (inclui o canal de suporte do
 * cliente); `support` = dono do sistema atendendo os canais de suporte de todos os clientes;
 * `staff` = a equipe do suporte entre si. A tela de conversa é a mesma; muda só a rota e a lista
 * que recarrega.
 */
export type ChatScope = 'team' | 'support' | 'staff';
const BASE: Record<ChatScope, string> = { team: '/internal-chat/chats', support: '/super-admin/support/chats', staff: '/super-admin/staff/chats' };
const LIST_KEY: Record<ChatScope, string> = { team: 'internal-chats', support: 'support-chats', staff: 'staff-chats' };

export const useInternalUsers = (enabled = true) =>
  useQuery({ queryKey: ['internal-users'], enabled, queryFn: () => api<InternalUser[]>('/internal-chat/users'), refetchInterval: 30_000 });

export const useInternalChats = (enabled = true) =>
  useQuery({ queryKey: ['internal-chats'], enabled, queryFn: () => api<InternalChat[]>('/internal-chat/chats'), refetchInterval: 60_000 });

/** Mensagens de uma conversa: primeira página = as mais novas; as seguintes = anteriores (rolar para cima). */
function useMessagesOf(base: string, key: string, chatId: string | null) {
  return useInfiniteQuery({
    queryKey: [key, chatId],
    enabled: !!chatId,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<InternalMessage[]>(`${base}/${chatId}/messages${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => (last.length >= PAGE ? last[0].createdAt : null),
  });
}
export const useInternalMessages = (chatId: string | null, scope: ChatScope = 'team') => useMessagesOf(BASE[scope], 'internal-messages', chatId);
export const useAuditInternalMessages = (chatId: string | null) => useMessagesOf('/internal-chat/audit/chats', 'internal-audit-messages', chatId);

/** Páginas (mais nova primeiro) → lista cronológica. */
export const internalMessagesInOrder = (data?: InfiniteData<InternalMessage[]>) => (data ? [...data.pages].reverse().flat() : []);

/** Chegada pelo socket (`internal_message`): entra na primeira página, sem duplicar. */
export function upsertInternalMessage(qc: ReturnType<typeof useQueryClient>, m: InternalMessage) {
  qc.setQueryData<InfiniteData<InternalMessage[]>>(['internal-messages', m.chatId], (old) => {
    if (!old) return old;
    if (old.pages.some((p) => p.some((x) => x.id === m.id))) return old;
    const [first = [], ...rest] = old.pages;
    return { ...old, pages: [[...first, m], ...rest] };
  });
  qc.invalidateQueries({ queryKey: ['internal-chats'] });
  qc.invalidateQueries({ queryKey: ['support-chats'] });
  qc.invalidateQueries({ queryKey: ['staff-chats'] });
}

export const useCreateInternalChat = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { userIds: string[]; name?: string }) => api<InternalChat>('/internal-chat/chats', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['internal-chats'] }),
  });
};

export const useSendInternalMessage = (chatId: string | null, scope: ChatScope = 'team') => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string; replyToId?: string }) => api<InternalMessage>(`${BASE[scope]}/${chatId}/messages`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (m) => upsertInternalMessage(qc, m),
  });
};

export const useMarkInternalRead = (scope: ChatScope = 'team') => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => api<{ ok: boolean }>(`${BASE[scope]}/${chatId}/read`, { method: 'POST' }),
    // suporte: a lista existe em vários recortes da fila (['support-chats', view]) — zera em todos
    onMutate: (chatId) => qc.setQueriesData<InternalChat[]>({ queryKey: [LIST_KEY[scope]] }, (old) => (Array.isArray(old) ? old.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)) : old)),
  });
};

/** Auditoria: todas as conversas do cliente (ou as de uma pessoa). */
export const useAuditInternalChats = (userId: string | null, enabled = true) =>
  useQuery({ queryKey: ['internal-audit-chats', userId], enabled, queryFn: () => api<InternalChat[]>(`/internal-chat/audit/chats${userId ? `?userId=${userId}` : ''}`) });

// ---- grupo: membros, nome, apagar (quem criou ou quem tem `team.manage`) ----
const invChats = (qc: ReturnType<typeof useQueryClient>) => () => qc.invalidateQueries({ queryKey: ['internal-chats'] });

export const useAddInternalMembers = (chatId: string) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (userIds: string[]) => api<InternalChat>(`/internal-chat/chats/${chatId}/members`, { method: 'POST', body: JSON.stringify({ userIds }) }), onSuccess: invChats(qc) });
};
/** Tira alguém — ou sai, quando `userId` é a própria pessoa. */
export const useRemoveInternalMember = (chatId: string) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (userId: string) => api<{ ok: boolean }>(`/internal-chat/chats/${chatId}/members/${userId}`, { method: 'DELETE' }), onSuccess: invChats(qc) });
};
export const useRenameInternalChat = (chatId: string) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => api<InternalChat>(`/internal-chat/chats/${chatId}`, { method: 'PATCH', body: JSON.stringify({ name }) }), onSuccess: invChats(qc) });
};
/** Some para os membros; o histórico continua na auditoria. */
export const useDeleteInternalChat = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (chatId: string) => api<{ ok: boolean }>(`/internal-chat/chats/${chatId}`, { method: 'DELETE' }), onSuccess: invChats(qc) });
};

// ---- canal de suporte: lado do dono do sistema (docs/chat-interno.md#suporte) ----
export interface SupportTenant { id: string; name: string; isActive: boolean }

/**
 * Recortes da fila de suporte: `queue` = na fila (ordem de chegada), `mine` = meus em andamento,
 * `active` = fila + em andamento, `resolved` = encerrados (7 dias), `all` = todo canal com mensagem.
 */
export type SupportView = 'queue' | 'mine' | 'active' | 'resolved' | 'all';

/** Canais de suporte de todos os clientes, com as não lidas e o atendimento. */
export const useSupportChats = (view: SupportView = 'all', enabled = true) =>
  useQuery({ queryKey: ['support-chats', view], enabled, queryFn: () => api<InternalChat[]>(`/super-admin/support/chats?view=${view}`), refetchInterval: 60_000 });

/** Contadores das abas (mesmo prefixo: recarrega junto com as listas a cada evento do socket). */
export const useSupportCounts = (enabled = true) =>
  useQuery({ queryKey: ['support-chats', 'counts'], enabled, queryFn: () => api<{ queue: number; mine: number; active: number }>('/super-admin/support/counts'), refetchInterval: 60_000 });

/** Assumir, devolver à fila ou encerrar um atendimento. */
export const useSupportTicketAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'assign' | 'release' | 'resolve' }) => api<{ ok: boolean }>(`/super-admin/support/tickets/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['support-chats'] }),
  });
};

export const useSupportTenants = (enabled = true) =>
  useQuery({ queryKey: ['support-tenants'], enabled, queryFn: () => api<SupportTenant[]>('/super-admin/support/tenants'), staleTime: 5 * 60_000 });

/** Abre (ou cria) o canal de um cliente — o suporte puxando a conversa. */
export const useOpenSupportChat = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) => api<InternalChat>(`/super-admin/support/tenants/${tenantId}/chat`, { method: 'POST' }),
    // canal sem mensagem ainda não está em `all`: entra na hora, para a tela conseguir abrir
    onSuccess: (c) => qc.setQueryData<InternalChat[]>(['support-chats', 'all'], (old) => (old?.some((x) => x.id === c.id) ? old : [c, ...(old ?? [])])),
  });
};

// ---- equipe do suporte: super_admins entre si (docs/chat-interno.md#equipe-do-suporte) ----

export const useStaffUsers = (enabled = true) =>
  useQuery({ queryKey: ['staff-users'], enabled, queryFn: () => api<InternalUser[]>('/super-admin/staff/users'), refetchInterval: 30_000 });

export const useStaffChats = (enabled = true) =>
  useQuery({ queryKey: ['staff-chats'], enabled, queryFn: () => api<InternalChat[]>('/super-admin/staff/chats'), refetchInterval: 60_000 });

/** Abre (ou reaproveita) a conversa direta com um colega do suporte. */
export const useOpenStaffChat = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api<InternalChat>('/super-admin/staff/chats', { method: 'POST', body: JSON.stringify({ userId }) }),
    onSuccess: (c) => qc.setQueryData<InternalChat[]>(['staff-chats'], (old) => (old?.some((x) => x.id === c.id) ? old : [...(old ?? []), c])),
  });
};
