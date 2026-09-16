'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken } from './api';
import type { ConversationStatus } from '@atendo/shared';

export interface Tag { id: string; name: string; color: string }
export interface NumberItem { id: string; phone: string; label: string; provider: 'meta' | 'evolution'; status: string }
export interface Conversation {
  id: string; status: ConversationStatus; unreadCount: number; lastMessageAt: string | null; lastMessagePreview: string | null;
  lastInboundAt: string | null; numberId: string;
  contact: { id: string; name: string | null; phone: string };
  tags: { tag: Tag }[];
  assignee: { id: string; name: string } | null;
  number: { id: string; label: string };
}
export interface Message {
  id: string; conversationId: string; direction: 'in' | 'out'; type: string; status: string;
  text: string | null; mediaUrl: string | null; createdAt: string; error?: string | null;
}
export interface Folder { id: string; name: string; replies: { id: string; title: string; body: string }[] }

export const useNumbers = () => useQuery({ queryKey: ['numbers'], queryFn: () => api<NumberItem[]>('/numbers') });
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: () => api<Tag[]>('/tags') });
export const useQuickReplies = () => useQuery({ queryKey: ['quick-replies'], queryFn: () => api<Folder[]>('/quick-replies') });
export const useUsage = () => useQuery({ queryKey: ['usage'], queryFn: () => api<{ used: { messages: number; templates: number }; limits: any; plan: string | null }>('/billing/usage'), refetchInterval: 60_000 });

export const useConversations = (q: { status: ConversationStatus; numberId: string | null; tagIds: string[]; search?: string }) =>
  useQuery({
    queryKey: ['conversations', q],
    queryFn: () => {
      const p = new URLSearchParams({ status: q.status });
      if (q.numberId) p.set('numberId', q.numberId);
      if (q.tagIds.length) p.set('tagIds', q.tagIds.join(','));
      if (q.search) p.set('search', q.search);
      return api<Conversation[]>(`/conversations?${p}`);
    },
  });

export const useMessages = (conversationId: string | null) =>
  useQuery({
    queryKey: ['messages', conversationId],
    enabled: !!conversationId,
    queryFn: async () => (await api<Message[]>(`/conversations/${conversationId}/messages`)).reverse(),
  });

export const useSendMessage = (conversationId: string | null) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api<Message>(`/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ type: 'text', text }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usage'] }),
  });
};

export const useSetStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ConversationStatus }) => api(`/conversations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
};

export const useSetTags = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tagIds }: { id: string; tagIds: string[] }) => api(`/conversations/${id}/tags`, { method: 'PATCH', body: JSON.stringify({ tagIds }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
};

/** Tempo real: aplica eventos do socket direto no cache do react-query. */
export function useRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const socket: Socket = io(process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3001', { auth: { token }, withCredentials: true });
    socket.on('message', (m: Message) => {
      qc.setQueryData<Message[]>(['messages', m.conversationId], (old) => {
        if (!old) return old;
        const i = old.findIndex((x) => x.id === m.id);
        return i >= 0 ? old.map((x) => (x.id === m.id ? m : x)) : [...old, m];
      });
    });
    socket.on('conversation', () => qc.invalidateQueries({ queryKey: ['conversations'] }));
    socket.on('number', () => qc.invalidateQueries({ queryKey: ['numbers'] }));
    return () => {
      socket.disconnect();
    };
  }, [qc]);
}
