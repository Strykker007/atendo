'use client';
/** Números de WhatsApp. */
'use client';
import { keepPreviousData, useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission, TypingEvent, SendLimits } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';
import { Message, NumberItem, ProviderConfig, SendDelayProfile, SendingStatus, Typing, invConv, upsertMessageInCache } from './core';
import type { MessageTemplate, TemplateValues } from '@atendo/shared';

// ---- Números ----
const invalidateNumbers = (qc: ReturnType<typeof useQueryClient>) => () => qc.invalidateQueries({ queryKey: ['numbers'] });

export const useCreateNumber = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { phone: string; label: string; color?: string; provider: 'meta' | 'evolution'; config: ProviderConfig }) =>
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
    mutationFn: ({ id, ...body }: { id: string; label?: string; color?: string; isActive?: boolean; sendDelay?: SendDelayProfile; sendDailyLimit?: number; endWarmup?: boolean; sendLimits?: Partial<SendLimits> | null; infraCostMonth?: number }) => api(`/numbers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: invalidateNumbers(qc),
  });
};
/** Quanto o número já enviou hoje e qual o teto vigente (com aquecimento). */
export const useSendingStatus = (id: string | null) => useQuery({ queryKey: ['sending', id], enabled: !!id, refetchInterval: 60_000, queryFn: () => api<SendingStatus>(`/numbers/${id}/sending`) });
export const useDeleteNumber = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/numbers/${id}`, { method: 'DELETE' }), onSuccess: invalidateNumbers(qc) });
};
/** QR code mais recente por número, alimentado pelo socket (evento `number`). */
export const useNumberQr = (id: string | null) => useQuery({ queryKey: ['number-qr', id], enabled: false, queryFn: () => null as string | null });

/** Tempo real: aplica eventos do socket direto no cache do react-query. */
export function useRealtime() {
  const qc = useQueryClient();
  // reexecuta quando o token aparece: na primeira montagem ele ainda não existe
  const [temToken, setTemToken] = useState(() => !!getAccessToken());
  useEffect(() => { const fora = onAccessToken((t) => setTemToken(!!t)); return () => { fora(); }; }, []);
  useEffect(() => {
    if (!getAccessToken()) return;
    // auth como função: a cada reconexão manda o token ATUAL (o access token expira em 15 min)
    const socket: Socket = io(process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000', { auth: (cb) => cb({ token: getAccessToken() }), withCredentials: true, reconnectionDelayMax: 5000 });
    socket.on('message', (m: Message) => {
      upsertMessageInCache(qc, m);
      // a mensagem chegou: quem estava digitando terminou (o "parou" pode vir depois ou nunca)
      if (m.direction === 'in') qc.setQueryData<Typing>(['typing', m.conversationId], null);
    });
    // histórico limpo: um evento só, a conversa recarrega já sem o conteúdo
    socket.on('messages_cleared', (e: { conversationId: string }) => {
      qc.invalidateQueries({ queryKey: ['messages', e.conversationId] });
    });
    socket.on('typing', (e: TypingEvent) => {
      const next: Typing = e.state === 'paused' ? null : { state: e.state, at: Date.now() };
      qc.setQueryData<Typing>(['typing', e.conversationId], next);
    });
    socket.on('conversation', (c: { id: string }) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation', c.id] });
      qc.invalidateQueries({ queryKey: ['conversation-counts'] });
      qc.invalidateQueries({ queryKey: ['active-run', c.id] });
      // pausa/retomada do robô entra no histórico
      qc.invalidateQueries({ queryKey: ['conversation-events', c.id] });
      // tag principal, posse, status e última mensagem mudam o quadro
      qc.invalidateQueries({ queryKey: ['kanban'] });
    });
    socket.on('kanban', () => { qc.invalidateQueries({ queryKey: ['kanban'] }); qc.invalidateQueries({ queryKey: ['tags'] }); });
    socket.on('scheduled_messages', (e: { conversationId: string }) => qc.invalidateQueries({ queryKey: ['scheduled-messages', e.conversationId] }));
    socket.on('appointment', () => { qc.invalidateQueries({ queryKey: ['appointments'] }); qc.invalidateQueries({ queryKey: ['contact-card'] }); });
    socket.on('number', (n: { id: string; status: string; qrCode?: string }) => {
      if (n.qrCode) qc.setQueryData(['number-qr', n.id], n.qrCode);
      if (n.status === 'connected') qc.setQueryData(['number-qr', n.id], null);
      qc.invalidateQueries({ queryKey: ['numbers'] });
    });
    return () => {
      socket.disconnect();
    };
  }, [qc, temToken]);
}

/** Templates aprovados (HSM) do número — só Meta; Evolution vem vazio. `sync()` ignora o cache do servidor. */
export const useTemplates = (numberId: string | null, enabled = true) => {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['templates', numberId], enabled: !!numberId && enabled, staleTime: 60_000, queryFn: () => api<MessageTemplate[]>(`/numbers/${numberId}/templates`) });
  const sync = useMutation({
    mutationFn: () => api<MessageTemplate[]>(`/numbers/${numberId}/templates?refresh=1`),
    onSuccess: (list) => qc.setQueryData(['templates', numberId], list),
  });
  return { ...q, sync };
};

/** Iniciar conversa (disparo ativo). Devolve a conversa para a tela abrir. */
export interface StartConversationInput {
  numberId: string;
  contactId?: string;
  phone?: string;
  name?: string;
  text?: string;
  template?: { name: string; language: string; header?: TemplateValues; body?: TemplateValues };
  idempotencyKey?: string;
}
export const useStartConversation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: StartConversationInput) => api<{ conversationId: string; message: Message }>('/conversations/start', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: (r) => { upsertMessageInCache(qc, r.message); invConv(qc, r.conversationId); qc.invalidateQueries({ queryKey: ['usage'] }); },
  });
};

/** Template pelo composer (janela de 24h fechada na Meta). Sai pelo número da conversa, como qualquer envio. */
export const useSendTemplate = (conversationId: string | null, expectedNumberId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { template: { name: string; language: string; header?: TemplateValues; body?: TemplateValues }; idempotencyKey: string }) =>
      api<Message>(`/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ type: 'text', ...b, expectedNumberId }) }),
    onSuccess: (m) => { upsertMessageInCache(qc, m); if (conversationId) invConv(qc, conversationId); qc.invalidateQueries({ queryKey: ['usage'] }); },
  });
};

/** Reler agora a agenda de contatos do celular (Evolution). Roda no worker. */
export const useSyncPhonebook = () => useMutation({ mutationFn: (numberId: string) => api<{ queued: boolean }>(`/numbers/${numberId}/contacts/sync`, { method: 'POST' }) });

/**
 * Valor que só muda depois de `ms` sem mexer — para a busca não disparar uma requisição por tecla.
 * Use o valor atrasado na queryKey e compare com o original para saber se há busca pendente.
 */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Sugestões do "Nova conversa": contatos da base + agenda do aparelho (quem ainda não é contato). */
export interface StartCandidates {
  contacts: { id: string; name: string | null; phone: string }[];
  phonebook: { phone: string; name: string; numberId: string }[];
}
/** `q` já com debounce; menos de 2 letras não busca. Mantém o resultado anterior enquanto o novo chega. */
export const useStartCandidates = (q: string, enabled = true) =>
  useQuery({
    queryKey: ['start-candidates', q],
    enabled: enabled && q.length >= 2,
    queryFn: () => api<StartCandidates>(`/conversations/start/contacts?q=${encodeURIComponent(q)}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

/** Linha da agenda do celular; `contactId` = a pessoa já é contato no painel. */
export interface PhonebookItem { id: string; phone: string; name: string; contactId: string | null }
interface PhonebookPage { items: PhonebookItem[]; nextCursor: string | null; total?: number }
/** Agenda do celular de um número (Evolution), paginada em ordem alfabética. `q` (já com debounce) filtra nome/telefone. */
export const usePhonebook = (numberId: string | null, q: string, enabled = true) =>
  useInfiniteQuery({
    queryKey: ['phonebook', numberId, q],
    enabled: !!numberId && enabled,
    // filtro novo: a lista anterior fica na tela até chegar a nova (só do mesmo número)
    placeholderData: (prev: InfiniteData<PhonebookPage, string | null> | undefined, prevQuery) => (prevQuery?.queryKey[1] === numberId ? prev : undefined),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (pageParam) p.set('cursor', pageParam);
      return api<PhonebookPage>(`/numbers/${numberId}/phonebook${p.toString() ? `?${p}` : ''}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
