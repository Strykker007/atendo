'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken } from './api';
import type { ConversationStatus, PlanLimits } from '@atendo/shared';

export interface Tag { id: string; name: string; color: string }
export interface NumberItem { id: string; phone: string; label: string; provider: 'meta' | 'evolution'; status: string; isActive: boolean; createdAt: string }
export type ProviderConfig = { instanceName?: string } | { phoneNumberId: string; wabaId: string; accessToken: string };
export interface Conversation {
  id: string; status: ConversationStatus; unreadCount: number; lastMessageAt: string | null; lastMessagePreview: string | null;
  lastInboundAt: string | null; numberId: string;
  contact: { id: string; name: string | null; phone: string };
  tags: { tag: Tag }[];
  assignee: { id: string; name: string } | null;
  number: { id: string; label: string; provider?: 'meta' | 'evolution'; status?: string };
}
export interface Message {
  id: string; conversationId: string; direction: 'in' | 'out'; type: string; status: string;
  text: string | null; mediaUrl: string | null; mediaMime: string | null; mediaName: string | null; createdAt: string; error?: string | null;
}
export interface Upload { key: string; url: string; mimeType: string; fileName: string; size: number }
export type SendInput = { type: 'text'; text: string } | { type: 'image' | 'audio' | 'video' | 'document'; mediaKey: string; text?: string; media: { url: string; mimeType: string; fileName: string } };
export interface Folder { id: string; name: string; replies: { id: string; title: string; body: string }[] }

export const useNumbers = () => useQuery({ queryKey: ['numbers'], queryFn: () => api<NumberItem[]>('/numbers') });
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: () => api<Tag[]>('/tags') });
export const useQuickReplies = () => useQuery({ queryKey: ['quick-replies'], queryFn: () => api<Folder[]>('/quick-replies') });
export interface Usage {
  period: string;
  used: { messages: number; templates: number; numbers: number; agents: number; messagesIn: number };
  limits: PlanLimits | null;
  status: string | null;
  plan: string | null;
  priceMonth: number | null;
  currentPeriodEnd: string | null;
  overageAmount: number;
}
export const useUsage = () => useQuery({ queryKey: ['usage'], queryFn: () => api<Usage>('/billing/usage'), refetchInterval: 60_000 });

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

export const useConversation = (id: string | null) =>
  useQuery({ queryKey: ['conversation', id], enabled: !!id, queryFn: () => api<Conversation>(`/conversations/${id}`) });

export const useMessages = (conversationId: string | null) =>
  useQuery({
    queryKey: ['messages', conversationId],
    enabled: !!conversationId,
    queryFn: async () => (await api<Message[]>(`/conversations/${conversationId}/messages`)).reverse(),
  });

export const useSendMessage = (conversationId: string | null) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendInput) => api<Message>(`/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usage'] }),
  });
};

export const useResend = () =>
  useMutation({ mutationFn: ({ conversationId, messageId }: { conversationId: string; messageId: string }) => api<Message>(`/conversations/${conversationId}/messages/${messageId}/resend`, { method: 'POST' }) });

/** Upload multipart (não passa pelo helper `api` porque o Content-Type é do FormData). */
export async function uploadFile(file: File): Promise<Upload> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/uploads`, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${getAccessToken()}` },
    body: form,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Erro ${res.status}`);
  return res.json();
}

export const mediaTypeOf = (mime: string): 'image' | 'audio' | 'video' | 'document' =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'document';

const invConv = (qc: ReturnType<typeof useQueryClient>, id: string) => {
  qc.invalidateQueries({ queryKey: ['conversations'] });
  qc.invalidateQueries({ queryKey: ['conversation', id] });
};
export const useSetStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ConversationStatus }) => api(`/conversations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: (_, v) => invConv(qc, v.id),
  });
};

export const useSetTags = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tagIds }: { id: string; tagIds: string[] }) => api(`/conversations/${id}/tags`, { method: 'PATCH', body: JSON.stringify({ tagIds }) }),
    onSuccess: (_, v) => invConv(qc, v.id),
  });
};

// ---- Números ----
const invalidateNumbers = (qc: ReturnType<typeof useQueryClient>) => () => qc.invalidateQueries({ queryKey: ['numbers'] });

export const useCreateNumber = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { phone: string; label: string; provider: 'meta' | 'evolution'; config: ProviderConfig }) =>
      api<NumberItem & { qrCode?: string }>('/numbers', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: invalidateNumbers(qc),
  });
};
export const useSwitchProvider = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; provider: 'meta' | 'evolution'; config: ProviderConfig }) =>
      api<NumberItem & { qrCode?: string }>(`/numbers/${id}/provider`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: invalidateNumbers(qc),
  });
};
export const useConnectNumber = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<NumberItem & { qrCode?: string }>(`/numbers/${id}/connect`, { method: 'POST' }),
    onSuccess: invalidateNumbers(qc),
  });
};
export const useUpdateNumber = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; label?: string; isActive?: boolean }) => api(`/numbers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: invalidateNumbers(qc),
  });
};
export const useDeleteNumber = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/numbers/${id}`, { method: 'DELETE' }), onSuccess: invalidateNumbers(qc) });
};
/** QR code mais recente por número, alimentado pelo socket (evento `number`). */
export const useNumberQr = (id: string | null) => useQuery({ queryKey: ['number-qr', id], enabled: false, queryFn: () => null as string | null });

/** Tempo real: aplica eventos do socket direto no cache do react-query. */
export function useRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const socket: Socket = io(process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000', { auth: { token }, withCredentials: true });
    socket.on('message', (m: Message) => {
      qc.setQueryData<Message[]>(['messages', m.conversationId], (old) => {
        if (!old) return old;
        const i = old.findIndex((x) => x.id === m.id);
        return i >= 0 ? old.map((x) => (x.id === m.id ? m : x)) : [...old, m];
      });
    });
    socket.on('conversation', (c: { id: string }) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation', c.id] });
    });
    socket.on('number', (n: { id: string; status: string; qrCode?: string }) => {
      if (n.qrCode) qc.setQueryData(['number-qr', n.id], n.qrCode);
      if (n.status === 'connected') qc.setQueryData(['number-qr', n.id], null);
      qc.invalidateQueries({ queryKey: ['numbers'] });
    });
    return () => {
      socket.disconnect();
    };
  }, [qc]);
}

// ---- Tags (admin) ----
export const useCreateTag = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { name: string; color: string }) => api<Tag>('/tags', { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }) });
};
export const useUpdateTag = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; color?: string }) => api<Tag>(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }) });
};
export const useDeleteTag = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/tags/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }) });
};

// ---- Equipe ----
export interface Agent { id: string; name: string; email: string; role: 'tenant_admin' | 'agent' | 'super_admin'; isActive: boolean; lastLoginAt: string | null }
export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => api<Agent[]>('/tenants/me/agents') });
export const useCreateAgent = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { name: string; email: string; password: string }) => api<Agent>('/tenants/me/agents', { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); qc.invalidateQueries({ queryKey: ['usage'] }); } });
};
export const useUpdateAgent = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; isActive?: boolean; password?: string }) => api(`/tenants/me/agents/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); qc.invalidateQueries({ queryKey: ['usage'] }); } });
};

// ---- Respostas rápidas (admin) ----
const invQR = (qc: ReturnType<typeof useQueryClient>) => () => qc.invalidateQueries({ queryKey: ['quick-replies'] });
export const useCreateFolder = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { name: string }) => api('/quick-replies/folders', { method: 'POST', body: JSON.stringify(b) }), onSuccess: invQR(qc) }); };
export const useUpdateFolder = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; position?: number }) => api(`/quick-replies/folders/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: invQR(qc) }); };
export const useDeleteFolder = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/quick-replies/folders/${id}`, { method: 'DELETE' }), onSuccess: invQR(qc) }); };
export const useCreateReply = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { folderId: string; title: string; body: string }) => api('/quick-replies', { method: 'POST', body: JSON.stringify(b) }), onSuccess: invQR(qc) }); };
export const useUpdateReply = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: { id: string; title?: string; body?: string }) => api(`/quick-replies/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: invQR(qc) }); };
export const useDeleteReply = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/quick-replies/${id}`, { method: 'DELETE' }), onSuccess: invQR(qc) }); };

/** Usuário logado (role, tenant) — para esconder ações de admin. */
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<{ id: string; tenantId: string; role: Agent['role']; email: string; name: string }>('/auth/me'), staleTime: Infinity });
