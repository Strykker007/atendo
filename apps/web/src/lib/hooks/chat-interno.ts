'use client';
/** Chat interno da equipe e canal de suporte do sistema — docs/chat-interno.md. */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { api } from '../api';

export interface InternalUser { id: string; name: string; email: string; /** painel aberto agora */ online: boolean }
export interface InternalChatMember { id: string; name: string; active: boolean }
export interface InternalChat {
  id: string;
  isGroup: boolean;
  /** canal com o suporte do sistema (um por cliente); no lado do dono, `name` = nome do cliente */
  isSupport?: boolean;
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
 * cliente); `support` = dono do sistema atendendo os canais de suporte de todos os clientes.
 * A tela de conversa é a mesma; muda só a rota e a lista que recarrega.
 */
export type ChatScope = 'team' | 'support';
const BASE: Record<ChatScope, string> = { team: '/internal-chat/chats', support: '/super-admin/support/chats' };
const LIST_KEY: Record<ChatScope, string> = { team: 'internal-chats', support: 'support-chats' };

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
    onMutate: (chatId) => qc.setQueryData<InternalChat[]>([LIST_KEY[scope]], (old) => old?.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c))),
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

/** Canais de suporte com mensagem, de todos os clientes, com as não lidas. */
export const useSupportChats = (enabled = true) =>
  useQuery({ queryKey: ['support-chats'], enabled, queryFn: () => api<InternalChat[]>('/super-admin/support/chats'), refetchInterval: 60_000 });

export const useSupportTenants = (enabled = true) =>
  useQuery({ queryKey: ['support-tenants'], enabled, queryFn: () => api<SupportTenant[]>('/super-admin/support/tenants'), staleTime: 5 * 60_000 });

/** Abre (ou cria) o canal de um cliente — o suporte puxando a conversa. */
export const useOpenSupportChat = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) => api<InternalChat>(`/super-admin/support/tenants/${tenantId}/chat`, { method: 'POST' }),
    onSuccess: (c) => qc.setQueryData<InternalChat[]>(['support-chats'], (old) => (old?.some((x) => x.id === c.id) ? old : [c, ...(old ?? [])])),
  });
};
