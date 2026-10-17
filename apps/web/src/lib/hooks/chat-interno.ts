'use client';
/** Chat interno da equipe — docs/chat-interno.md. */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { api } from '../api';

export interface InternalUser { id: string; name: string; email: string; /** painel aberto agora */ online: boolean }
export interface InternalChatMember { id: string; name: string; active: boolean }
export interface InternalChat {
  id: string;
  isGroup: boolean;
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
  replyToId?: string | null;
  /** trecho da mensagem respondida; null = ela não existe mais */
  replyTo?: { id: string; authorId: string | null; authorName: string; text: string; system: boolean } | null;
}

const PAGE = 50;

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
export const useInternalMessages = (chatId: string | null) => useMessagesOf('/internal-chat/chats', 'internal-messages', chatId);
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
}

export const useCreateInternalChat = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { userIds: string[]; name?: string }) => api<InternalChat>('/internal-chat/chats', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['internal-chats'] }),
  });
};

export const useSendInternalMessage = (chatId: string | null) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string; replyToId?: string }) => api<InternalMessage>(`/internal-chat/chats/${chatId}/messages`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (m) => upsertInternalMessage(qc, m),
  });
};

export const useMarkInternalRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => api<{ ok: boolean }>(`/internal-chat/chats/${chatId}/read`, { method: 'POST' }),
    onMutate: (chatId) => qc.setQueryData<InternalChat[]>(['internal-chats'], (old) => old?.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c))),
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
