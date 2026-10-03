'use client';
/** Base do painel: tipos compartilhados, conversas, mensagens e posse do atendimento.
 * É o que quase toda tela usa — por isso os outros arquivos importam daqui, e nunca o contrário. */
'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';

export interface Tag { id: string; name: string; color: string }
export type SendDelayProfile = 'instant' | 'fast' | 'short' | 'medium' | 'long';
export interface NumberItem { id: string; phone: string; label: string; provider: 'meta' | 'evolution'; status: string; isActive: boolean; createdAt: string; sendDelay: SendDelayProfile; sendDailyLimit: number; warmupStartedAt: string | null; infraCostMonth?: string | number }
export interface SendingStatus { ok: boolean; reason?: string; limit: number; sent: number; sendDelay: SendDelayProfile; warmupStartedAt: string | null }
export type ProviderConfig = { instanceName?: string } | { phoneNumberId: string; wabaId: string; accessToken: string };
export type ConversationOrigin = 'organic' | 'ad' | 'post' | 'link';
export type ConversationOutcome = 'none' | 'won' | 'lost';
export interface LeadReferral { sourceType: string; sourceId?: string; sourceUrl?: string; headline?: string; body?: string; ctwaClid?: string; mediaUrl?: string }
export interface Conversation {
  id: string; status: ConversationStatus; unreadCount: number; lastMessageAt: string | null; lastMessagePreview: string | null;
  origin: ConversationOrigin; originData: LeadReferral | null;
  activeFlowRunId?: string | null;
  lastInboundAt: string | null; numberId: string;
  /** desde quando o contato espera resposta; null = já respondemos */
  awaitingSince: string | null;
  contact: { id: string; name: string | null; phone: string; avatarUrl?: string | null; email?: string | null; address?: string | null; note1?: string | null; note2?: string | null; tags?: { tag: Tag }[] };
  tags: { tag: Tag }[];
  assignee: { id: string; name: string } | null;
  number: { id: string; label: string; provider?: 'meta' | 'evolution'; status?: string };
}
export interface Message {
  id: string; conversationId: string; direction: 'in' | 'out'; type: string; status: string;
  text: string | null; mediaUrl: string | null; mediaMime: string | null; mediaName: string | null; createdAt: string; error?: string | null;
  externalId?: string | null;
  /** id da mensagem citada no provider */
  quotedId?: string | null;
  /** texto do que foi citado, quando a citada não está no nosso histórico (resposta a status) */
  quotedPreview?: string | null;
  quotedFromStatus?: boolean;
  /** nota interna (cadeado): só a equipe vê */
  internal?: boolean; authorId?: string | null; author?: { name: string } | null;
}
export interface Upload { key: string; url: string; mimeType: string; fileName: string; size: number }
export type SendInput = ({ type: 'text'; text: string } | { type: 'image' | 'audio' | 'video' | 'document'; mediaKey: string; text?: string; media: { url: string; mimeType: string; fileName: string } }) & {
  /** responder citando uma mensagem (o id dela no provider) */
  quotedExternalId?: string;
};
export interface QuickReplyItem { id: string; title: string; body: string; mediaKey?: string | null; mediaType?: 'image' | 'audio' | 'video' | 'document' | null; mediaName?: string | null; mediaMime?: string | null; mediaUrl?: string | null }
export interface Folder { id: string; name: string; replies: QuickReplyItem[] }

export const useNumbers = () => useQuery({ queryKey: ['numbers'], queryFn: () => api<NumberItem[]>('/numbers') });
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: () => api<Tag[]>('/tags') });
export const useQuickReplies = () => useQuery({ queryKey: ['quick-replies'], queryFn: () => api<Folder[]>('/quick-replies') });
export interface Usage {
  period: string;
  billingEnabled: boolean;
  cancelAtPeriodEnd: boolean;
  graceUntil: string | null;
  planId: string | null;
  used: { messages: number; templates: number; numbers: number; agents: number; messagesIn: number; conversations: number };
  limits: PlanLimits | null;
  status: string | null;
  plan: string | null;
  priceMonth: number | null;
  /** reajuste já avisado e ainda não aplicado */
  priceChange: { priceMonth: number; at: string } | null;
  currentPeriodEnd: string | null;
  overageAmount: number;
}
export const useUsage = () => useQuery({ queryKey: ['usage'], queryFn: () => api<Usage>('/billing/usage'), refetchInterval: 60_000 });

export type OrdemConversas = 'recent' | 'waiting';

export const useConversations = (q: { status: ConversationStatus; numberId: string | null; tagIds: string[]; search?: string; origin?: ConversationOrigin | null; assigneeId?: string | null; sort?: OrdemConversas }) =>
  useQuery({
    queryKey: ['conversations', q],
    queryFn: () => {
      const p = new URLSearchParams({ status: q.status });
      if (q.numberId) p.set('numberId', q.numberId);
      if (q.assigneeId) p.set('assigneeId', q.assigneeId);
      if (q.origin) p.set('origin', q.origin);
      if (q.tagIds.length) p.set('tagIds', q.tagIds.join(','));
      if (q.search) p.set('search', q.search);
      if (q.sort && q.sort !== 'recent') p.set('sort', q.sort);
      return api<Conversation[]>(`/conversations?${p}`);
    },
  });

export const invConv = (qc: ReturnType<typeof useQueryClient>, id: string) => {
  qc.invalidateQueries({ queryKey: ['conversations'] });
  qc.invalidateQueries({ queryKey: ['conversation', id] });
  qc.invalidateQueries({ queryKey: ['conversation-counts'] });
};

export const useConversationCounts = (numberId: string | null) =>
  useQuery({ queryKey: ['conversation-counts', numberId], queryFn: () => api<{ waiting: number; in_progress: number; closed: number; in_progress_mine: number; in_progress_all: number }>(`/conversations/counts${numberId ? `?numberId=${numberId}` : ''}`), refetchInterval: 30_000 });

// ---- posse do atendimento ----
export const useClaim = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api<Conversation>(`/conversations/${id}/claim`, { method: 'POST' }), onSuccess: (_, id) => invConv(qc, id) }); };
export const useTransfer = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, agentId }: { id: string; agentId: string }) => api<Conversation>(`/conversations/${id}/transfer`, { method: 'POST', body: JSON.stringify({ agentId }) }), onSuccess: (_, v) => invConv(qc, v.id) }); };
export const useRelease = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api<Conversation>(`/conversations/${id}/release`, { method: 'POST' }), onSuccess: (_, id) => invConv(qc, id) }); };

export const useConversation = (id: string | null) =>
  useQuery({ queryKey: ['conversation', id], enabled: !!id, queryFn: () => api<Conversation>(`/conversations/${id}`) });

/** Tamanho da página no servidor. Se mudar lá, muda aqui: é o que diz se ainda há passado. */
export const PAGINA_MENSAGENS = 50;

/**
 * Mensagens da conversa, do fim para trás.
 *
 * Nada é apagado no banco — a conversa inteira fica guardada para sempre. O que não dá é
 * carregar tudo de uma vez: um cliente de dois anos tem milhares de mensagens, e abrir a
 * conversa baixaria todas antes de mostrar a primeira. Então vem a última página e o resto
 * sobe conforme a pessoa rola, como no WhatsApp.
 *
 * Cada página vem do servidor da mais nova para a mais antiga; o cursor é o id da última
 * linha recebida.
 */
export const useMessages = (conversationId: string | null) =>
  useInfiniteQuery({
    queryKey: ['messages', conversationId],
    enabled: !!conversationId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Message[]>(`/conversations/${conversationId}/messages${pageParam ? `?cursor=${pageParam}` : ''}`),
    // página incompleta = chegou no começo da conversa, não há mais o que buscar
    getNextPageParam: (ultima) => (ultima.length < PAGINA_MENSAGENS ? undefined : ultima[ultima.length - 1]?.id),
  });

/** As páginas viram uma lista só, em ordem cronológica (a tela lê de cima para baixo). */
export function mensagensEmOrdem(data?: InfiniteData<Message[]>): Message[] {
  return (data?.pages.flat() ?? []).slice().reverse();
}

/**
 * Insere/atualiza uma mensagem no cache da conversa (mesma lógica do socket).
 *
 * A página 0 é a mais recente, e dentro dela a ordem é do mais novo para o mais antigo —
 * por isso a mensagem nova entra no **começo** dela. Colocar no fim a jogaria para o meio da
 * conversa, entre mensagens antigas.
 */
export function upsertMessageInCache(qc: ReturnType<typeof useQueryClient>, m: Message) {
  qc.setQueryData<InfiniteData<Message[]>>(['messages', m.conversationId], (old) => {
    if (!old) return old;
    let achou = false;
    const pages = old.pages.map((p) =>
      p.map((x) => {
        if (x.id !== m.id) return x;
        achou = true;
        return { ...x, ...m };
      }),
    );
    if (achou) return { ...old, pages };
    return { ...old, pages: pages.map((p, i) => (i === 0 ? [m, ...p] : p)) };
  });
}

/**
 * Zera o contador de não lidas da conversa aberta.
 *
 * A rota existia desde o começo e **ninguém a chamava**: o balãozinho de não lidas aparecia,
 * a pessoa abria a conversa, lia tudo, e o número continuava lá para sempre. Um contador que
 * nunca zera é pior que contador nenhum, porque ensina a ignorá-lo.
 */
export const useMarkRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/conversations/${id}/read`, { method: 'POST' }),
    // some da lista na hora, sem esperar o servidor: é só um badge, e esperar faz piscar
    onMutate: (id) => {
      qc.setQueriesData<Conversation[]>({ queryKey: ['conversations'] }, (old) =>
        old?.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversation-counts'] }),
  });
};

export const useSendMessage = (conversationId: string | null) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendInput) => api<Message>(`/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify(input) }),
    // aparece na hora, mesmo se o socket estiver reconectando
    onSuccess: (m) => { upsertMessageInCache(qc, m); qc.invalidateQueries({ queryKey: ['usage'] }); },
  });
};

export const useSendNote = (conversationId: string | null) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (text: string) => api<Message>(`/conversations/${conversationId}/notes`, { method: 'POST', body: JSON.stringify({ text }) }), onSuccess: (m) => upsertMessageInCache(qc, m) });
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

export const useSetStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status: ConversationStatus; outcome?: ConversationOutcome; value?: number; reason?: string; flowId?: string }) => api(`/conversations/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (_, v) => invConv(qc, v.id),
  });
};

/** Encerrar vários atendimentos de uma vez. Devolve quantos fecharam e quantos ficaram de fora. */
export const useBulkClose = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { ids: string[]; outcome?: ConversationOutcome; reason?: string }) =>
      api<{ closed: number; ignored: number }>('/conversations/bulk/close', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation-counts'] });
    },
  });
};

export interface PlanRow {
  id: string;
  name: string;
  priceMonth: number;
  billingModel: 'fixed' | 'usage' | 'hybrid';
  limits: PlanLimits;
  stripePriceId: string | null;
  costMonth: number;
  isActive: boolean;
  subscribers: number;
  /** quantos ainda pagam valor diferente do atual (reajuste pendente ou nunca feito) */
  onOldPrice: number;
  /** data em que o preço atual passa a valer também para quem já assina */
  priceAppliesToExistingAt: string | null;
  /** cobrança configurada no servidor; sem isso "sem Stripe" seria alarme falso */
  billingEnabled?: boolean;
}
export interface PlanInput {
  name: string;
  priceMonth: number;
  costMonth?: number;
  billingModel: 'fixed' | 'usage' | 'hybrid';
  limits: PlanLimits;
  isActive?: boolean;
  /** o que fazer com quem já assina quando o preço muda */
  applyToExisting?: { mode: 'never' | 'scheduled' | 'now'; days?: number };
}

/** Catálogo do dono: inclui inativos e quantos clientes cada plano tem. */
export const useAllPlans = () => useQuery({ queryKey: ['plans-all'], queryFn: () => api<PlanRow[]>('/billing/plans/all') });

const invPlanos = (qc: ReturnType<typeof useQueryClient>) => { qc.invalidateQueries({ queryKey: ['plans-all'] }); qc.invalidateQueries({ queryKey: ['plans'] }); };

export const useCreatePlan = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: PlanInput) => api<PlanRow>('/billing/plans', { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => invPlanos(qc) });
};
export const useUpdatePlan = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...b }: PlanInput & { id: string }) => api<PlanRow>(`/billing/plans/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: () => invPlanos(qc) });
};
export const useDeletePlan = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/billing/plans/${id}`, { method: 'DELETE' }), onSuccess: () => invPlanos(qc) });
};

export interface ConversationEvent {
  id: string;
  type: 'claimed' | 'transferred' | 'released' | 'closed' | 'reopened';
  actor: { id: string; name: string } | null;
  target: { id: string; name: string } | null;
  fromStatus: ConversationStatus | null;
  toStatus: ConversationStatus | null;
  outcome: ConversationOutcome | null;
  outcomeValue: string | null;
  reason: string | null;
  createdAt: string;
}

/** Histórico do atendimento (auditoria). Só busca quando o painel está aberto. */
export const useConversationEvents = (id: string | null, enabled = true) =>
  useQuery({
    queryKey: ['conversation-events', id],
    queryFn: () => api<ConversationEvent[]>(`/conversations/${id}/events`),
    enabled: !!id && enabled,
  });

/** Ficha do contato (nome, e-mail, endereço, observações). */
export const useUpdateContact = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, ...b }: { contactId: string; name?: string; email?: string; address?: string; note1?: string; note2?: string }) => api(`/conversations/contacts/${contactId}`, { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conversation'] }); qc.invalidateQueries({ queryKey: ['conversations'] }); },
  });
};
export const useSetContactTags = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, tagIds }: { contactId: string; tagIds: string[] }) => api(`/conversations/contacts/${contactId}/tags`, { method: 'PATCH', body: JSON.stringify({ tagIds }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conversations'] }); qc.invalidateQueries({ queryKey: ['conversation'] }); },
  });
};

export const useSetTags = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tagIds }: { id: string; tagIds: string[] }) => api(`/conversations/${id}/tags`, { method: 'PATCH', body: JSON.stringify({ tagIds }) }),
    onSuccess: (_, v) => invConv(qc, v.id),
  });
};
