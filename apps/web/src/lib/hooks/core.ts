'use client';
/** Base do painel: tipos compartilhados, conversas, mensagens e posse do atendimento.
 * É o que quase toda tela usa — por isso os outros arquivos importam daqui, e nunca o contrário. */
'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, ApiError, onAccessToken } from '../api';
import type { BillingCycle, ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission, QuotedRef, MessageContent, SendLimits, DeletedMessageOriginal } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';

export interface Tag { id: string; name: string; color: string; isKanban?: boolean; position?: number }
export type SendDelayProfile = 'instant' | 'fast' | 'short' | 'moderate' | 'medium' | 'long';
export interface NumberItem { id: string; phone: string; label: string; color: string; provider: 'meta' | 'evolution'; status: string; isActive: boolean; createdAt: string; sendDelay: SendDelayProfile; sendDailyLimit: number; sendLimits?: Partial<SendLimits> | null; warmupStartedAt: string | null; infraCostMonth?: string | number; /** quadro de horários próprio; null = o padrão */ scheduleId?: string | null; /** empresa/unidade do número; null = sem empresa */ companyId?: string | null; /** última vez que o WhatsApp derrubou a conexão (401 device_removed) */ waRemovedAt?: string | null; /** quedas seguidas em 24h */ waRemovedCount?: number; /** reconectar antes disto pede confirmação */ reconnectBlockedUntil?: string | null; /** aquecimento da sessão (QR lido há < 72h); null = operação normal */ warmup?: { phase: number; newConvPerHour: number; minGapMs: number; autoPerHour: number; endsAt: string } | null; /** quem pediu pode gerenciar a conexão deste número (QR, reconectar, excluir) */ manageable?: boolean }
export interface SendingStatus { ok: boolean; reason?: string; limit: number; sent: number; sendDelay: SendDelayProfile; warmupStartedAt: string | null }
export type ProviderConfig = { instanceName?: string } | { phoneNumberId: string; wabaId: string; accessToken: string };
export type ConversationOrigin = 'organic' | 'ad' | 'post' | 'link';
export type ConversationOutcome = 'none' | 'won' | 'lost';
export interface LeadReferral { sourceType: string; sourceId?: string; sourceUrl?: string; headline?: string; body?: string; ctwaClid?: string; mediaUrl?: string }
export interface Conversation {
  id: string; status: ConversationStatus; unreadCount: number; lastMessageAt: string | null; lastMessagePreview: string | null;
  origin: ConversationOrigin; originData: LeadReferral | null;
  activeFlowRunId?: string | null;
  /** robô pausado só nesta conversa (ver `botPaused`); `botPausedUntil` nulo = até retomar manualmente */
  botPausedAt?: string | null; botPausedUntil?: string | null; botPausedBy?: { id: string; name: string } | null;
  lastInboundAt: string | null; numberId: string;
  /** desde quando o contato espera resposta; null = já respondemos */
  awaitingSince: string | null;
  contact: { id: string; name: string | null; phone: string; avatarUrl?: string | null; email?: string | null; address?: string | null; note1?: string | null; note2?: string | null; tags?: { tag: Tag }[]; /** pediu para não receber automáticas ("sair") */ optOutAt?: string | null; /** a checagem disse que o telefone não tem WhatsApp */ waInvalidAt?: string | null };
  /** `isPrimary` = etapa do atendimento no Kanban (no máximo uma) */
  tags: { tag: Tag; isPrimary?: boolean }[];
  assignee: { id: string; name: string } | null;
  /** departamento da conversa; null = sem departamento */
  departmentId?: string | null;
  department?: { id: string; name: string; color: string; isActive: boolean } | null;
  number: { id: string; label: string; phone?: string; color?: string; provider?: 'meta' | 'evolution'; status?: string };
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
  /** citação já resolvida pela API (`present()`); preferir a ela os campos quoted* soltos */
  quoted?: QuotedRef | null;
  /** reações (emoji) — no 1:1 no máximo uma de cada lado; `fromMe` = feita pelo celular do cliente */
  reactions?: { emoji: string; fromMe: boolean; at: string }[] | null;
  /** nota interna (cadeado): só a equipe vê. `authorName` = nome gravado na nota (sobrevive à remoção do usuário) */
  internal?: boolean; authorId?: string | null; author?: { name: string } | null; authorName?: string | null;
  /** botões, lista, localização ou contato; o corpo continua em `text` */
  content?: MessageContent | null;
  /** encaminhada (pelo contato ou pelo atendente); score ≥ 5 = "com frequência" */
  forwarded?: boolean; forwardingScore?: number | null;
  /** apagada: a API já manda sem conteúdo; o original só por `useDeletedOriginal` (conversations.view_deleted) */
  deletedAt?: string | null; deletedByName?: string | null;
  /** true = apagada também no celular do contato */
  deletedForEveryone?: boolean;
  /** texto trocado depois do envio (pelo atendente ou no celular) — a bolha mostra "editada" */
  editedAt?: string | null;
}
export interface Upload { key: string; url: string; mimeType: string; fileName: string; size: number }
export type SendInput = ({ type: 'text'; text: string } | { type: 'image' | 'audio' | 'video' | 'document'; mediaKey: string; text?: string; media: { url: string; mimeType: string; fileName: string } }) & {
  /** responder citando uma mensagem (o id dela no provider) */
  quotedExternalId?: string;
  /**
   * Caracteres que o atendente NÃO digitou (resposta rápida, colado, só mídia): a API mostra
   * "digitando…" ao contato pelo tempo de escrevê-los antes de entregar. Ausente = tudo digitado.
   */
  simulateTypingChars?: number;
  /** uma por envio (não por tentativa): a API devolve a mesma mensagem se a requisição repetir */
  idempotencyKey?: string;
};
export interface QuickReplyItem { id: string; title: string; body: string; mediaKey?: string | null; mediaType?: 'image' | 'audio' | 'video' | 'document' | null; mediaName?: string | null; mediaMime?: string | null; mediaUrl?: string | null }
export interface Folder { id: string; name: string; replies: QuickReplyItem[] }

export const useNumbers = () => useQuery({ queryKey: ['numbers'], queryFn: () => api<NumberItem[]>('/numbers') });
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: () => api<Tag[]>('/tags') });
export const useQuickReplies = () => useQuery({ queryKey: ['quick-replies'], queryFn: () => api<Folder[]>('/quick-replies') });
/** No cliente: se o preço escala por empresa. Na empresa: herda do grupo ou tem assinatura própria (docs/empresas.md#cobrança). */
export type BillingType = 'INDIVIDUAL' | 'CONSOLIDATED_GROUP';

export interface Usage {
  period: string;
  billingEnabled: boolean;
  /** gateway dos checkouts novos: asaas = modal PIX/cartão; stripe = redireciona ao Checkout */
  gateway: 'asaas' | 'stripe' | null;
  /** onde a assinatura atual nasceu (portal do Stripe x cobrança do Asaas) */
  subscriptionGateway: 'asaas' | 'stripe' | null;
  cancelAtPeriodEnd: boolean;
  graceUntil: string | null;
  planId: string | null;
  used: { messages: number; templates: number; numbers: number; agents: number; flows: number; quickReplies: number; messagesIn: number; conversations: number; companies?: number };
  limits: PlanLimits | null;
  status: string | null;
  plan: string | null;
  /** plano gratuito: sem fatura. `durationDays` null = permanente; senão termina em `currentPeriodEnd` */
  freePlan: { durationDays: number | null } | null;
  billingCycle: BillingCycle | null;
  /** valor do ciclo já multiplicado pelas unidades do grupo */
  priceMonth: number | null;
  /** grupo consolidado: quantas empresas a assinatura cobra (1 fora do grupo) */
  units: number;
  billingType: BillingType;
  /** reajuste já avisado e ainda não aplicado */
  priceChange: { priceMonth: number; at: string } | null;
  currentPeriodEnd: string | null;
  overageAmount: number;
}
export const useUsage = () => useQuery({ queryKey: ['usage'], queryFn: () => api<Usage>('/billing/usage'), refetchInterval: 60_000 });

export type OrdemConversas = 'recent' | 'waiting';

export const useConversations = (q: { status: ConversationStatus; numberId: string | null; departmentId?: string | null; tagIds: string[]; search?: string; origin?: ConversationOrigin | null; assigneeId?: string | null; sort?: OrdemConversas }) =>
  useQuery({
    queryKey: ['conversations', q],
    queryFn: () => {
      const p = new URLSearchParams({ status: q.status });
      if (q.numberId) p.set('numberId', q.numberId);
      if (q.departmentId) p.set('departmentId', q.departmentId);
      if (q.assigneeId) p.set('assigneeId', q.assigneeId);
      if (q.origin) p.set('origin', q.origin);
      if (q.tagIds.length) p.set('tagIds', q.tagIds.join(','));
      if (q.search) p.set('search', q.search);
      if (q.sort && q.sort !== 'recent') p.set('sort', q.sort);
      return api<Conversation[]>(`/conversations?${p}`);
    },
    // sempre "velha": trocar de aba busca de novo (troca de chave só refaz a busca de dado velho).
    // A lista de outra aba no cache podia ser de antes de encerrar/assumir
    staleTime: 0,
  });

export const invConv = (qc: ReturnType<typeof useQueryClient>, id: string) => {
  qc.invalidateQueries({ queryKey: ['conversations'] });
  qc.invalidateQueries({ queryKey: ['conversation', id] });
  qc.invalidateQueries({ queryKey: ['conversation-counts'] });
};

export const useConversationCounts = (numberId: string | null, departmentId: string | null = null) =>
  useQuery({
    queryKey: ['conversation-counts', numberId, departmentId],
    queryFn: () => {
      const p = new URLSearchParams();
      if (numberId) p.set('numberId', numberId);
      if (departmentId) p.set('departmentId', departmentId);
      return api<{ waiting: number; in_progress: number; closed: number; in_progress_mine: number; in_progress_all: number }>(`/conversations/counts${p.toString() ? `?${p}` : ''}`);
    },
    refetchInterval: 30_000,
  });

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

/**
 * As páginas viram uma lista só, em ordem cronológica (a tela lê de cima para baixo).
 *
 * Ordena pelo horário da mensagem, não pela ordem de chegada: o socket põe cada mensagem nova
 * no topo da página 0, e quando o número reconecta a Evolution despeja o atraso fora de ordem
 * (a das 00:51 chegava antes da das 00:41). O sort é estável — empate no mesmo segundo fica na
 * ordem de chegada, igual à API.
 */
export function mensagensEmOrdem(data?: InfiniteData<Message[]>): Message[] {
  return (data?.pages.flat() ?? [])
    .slice()
    .reverse()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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

/** O que o contato está fazendo agora; `at` = quando o evento chegou. Alimentado pelo socket (`typing`). */
export type Typing = { state: 'composing' | 'recording'; at: number } | null;
/** Sem novo evento nesse tempo, o indicador some: o "parou" do WhatsApp às vezes não chega. */
export const TYPING_TIMEOUT_MS = 5_000;

/** "Digitando…"/"gravando áudio…" do contato nesta conversa. Some sozinho após `TYPING_TIMEOUT_MS`. */
export function useTyping(conversationId: string | null): Typing {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['typing', conversationId], enabled: false, staleTime: Infinity, queryFn: () => null as Typing });
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => qc.setQueryData(['typing', conversationId], null), Math.max(0, data.at + TYPING_TIMEOUT_MS - Date.now()));
    return () => clearTimeout(t);
  }, [data, conversationId, qc]);
  return data ?? null;
}

/**
 * Zera o contador de não lidas da conversa aberta.
 *
 * A rota existia desde o começo e **ninguém a chamava**: o balãozinho de não lidas aparecia,
 * a pessoa abria a conversa, lia tudo, e o número continuava lá para sempre. Um contador que
 * nunca zera é pior que contador nenhum, porque ensina a ignorá-lo.
 */
/**
 * "digitando…" do atendente no WhatsApp do contato, com começo e fim (só número QR; a API
 * decide). Enquanto a pessoa digita, renova a cada 2 s; 3 s sem teclar, enviar, apagar o texto ou
 * trocar de conversa manda "parou". Falha é ignorada — é humanização, não pode travar o chat.
 */
export function useTypingPresence(conversationId: string | null | undefined) {
  const ativo = useRef<string | null>(null);
  const ultimo = useRef(0);
  const ocioso = useRef<ReturnType<typeof setTimeout> | null>(null);

  const post = (id: string, state: 'composing' | 'paused') =>
    api(`/conversations/${id}/typing`, { method: 'POST', body: JSON.stringify({ state }) }).catch(() => undefined);

  const parar = useCallback(() => {
    if (ocioso.current) clearTimeout(ocioso.current);
    ocioso.current = null;
    const id = ativo.current;
    ativo.current = null;
    ultimo.current = 0;
    if (id) void post(id, 'paused');
  }, []);

  /** chamar a cada mudança do texto */
  const digitou = useCallback((text: string) => {
    if (!conversationId || !text.trim()) return parar();
    if (ativo.current && ativo.current !== conversationId) parar();
    if (Date.now() - ultimo.current >= 2_000) {
      ativo.current = conversationId;
      ultimo.current = Date.now();
      void post(conversationId, 'composing');
    }
    if (ocioso.current) clearTimeout(ocioso.current);
    ocioso.current = setTimeout(parar, 3_000);
  }, [conversationId, parar]);

  // trocou de conversa ou saiu da tela: para o "digitando" da anterior
  useEffect(() => parar, [conversationId, parar]);

  return { digitou, parar };
}

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

/**
 * Marcar como não lida (docs/08-frontend.md). `messageId` = a partir daquela mensagem.
 * O badge aparece na hora; o número exato vem do servidor (e chega aos outros pelo socket).
 */
export const useMarkUnread = () => {
  const qc = useQueryClient();
  const aplicar = (id: string, n: (atual: number) => number) =>
    qc.setQueriesData<Conversation[]>({ queryKey: ['conversations'] }, (old) =>
      old?.map((c) => (c.id === id ? { ...c, unreadCount: n(c.unreadCount) } : c)),
    );
  return useMutation({
    mutationFn: ({ id, messageId }: { id: string; messageId?: string }) =>
      api<{ unreadCount: number }>(`/conversations/${id}/unread`, { method: 'PATCH', body: JSON.stringify({ messageId }) }),
    onMutate: ({ id }) => aplicar(id, (atual) => Math.max(atual, 1)),
    onSuccess: (conv, { id }) => {
      aplicar(id, () => conv.unreadCount);
      qc.invalidateQueries({ queryKey: ['conversation-counts'] });
    },
    onError: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
};

/**
 * Envio do atendente. `expectedNumberId` é o canal que a tela está mostrando: a API só confere
 * (quem escolhe o número é a conversa) e devolve 409 `number_changed` se a conversa mudou de canal —
 * aí recarrega a conversa para a tela mostrar o canal novo antes de qualquer reenvio.
 */
export const useSendMessage = (conversationId: string | null, expectedNumberId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendInput) => api<Message>(`/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ ...input, expectedNumberId }) }),
    // aparece na hora, mesmo se o socket estiver reconectando
    // cold-quota: responder contato frio no QR gasta uma vaga do dia
    onSuccess: (m) => { upsertMessageInCache(qc, m); moverConversaParaTopo(qc, m); qc.invalidateQueries({ queryKey: ['usage'] }); qc.invalidateQueries({ queryKey: ['cold-quota'] }); },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'number_changed') {
        qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
        qc.invalidateQueries({ queryKey: ['conversations'] });
      }
    },
  });
};

/**
 * Atualiza só a conversa da mensagem enviada nas listas em cache (prévia, hora e, na ordem
 * "recentes", sobe para o topo). As outras linhas ficam como estão — nada de trocar a lista
 * inteira pelo que veio no envio. O refetch que o socket dispara depois corrige o resto.
 */
function moverConversaParaTopo(qc: ReturnType<typeof useQueryClient>, m: Message) {
  for (const [key, lista] of qc.getQueriesData<Conversation[]>({ queryKey: ['conversations'] })) {
    const i = lista?.findIndex((c) => c.id === m.conversationId) ?? -1;
    if (!lista || i < 0) continue;
    const atual = { ...lista[i], lastMessageAt: m.createdAt, lastMessagePreview: m.text || lista[i].lastMessagePreview, awaitingSince: null };
    const ordem = (key[1] as { sort?: OrdemConversas } | undefined)?.sort ?? 'recent';
    const resto = lista.filter((_, j) => j !== i);
    qc.setQueryData<Conversation[]>(key, ordem === 'recent' ? [atual, ...resto] : lista.map((c, j) => (j === i ? atual : c)));
  }
}

export const useSendNote = (conversationId: string | null) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (text: string) => api<Message>(`/conversations/${conversationId}/notes`, { method: 'POST', body: JSON.stringify({ text }) }), onSuccess: (m) => upsertMessageInCache(qc, m) });
};

export const useResend = () =>
  useMutation({ mutationFn: ({ conversationId, messageId }: { conversationId: string; messageId: string }) => api<Message>(`/conversations/${conversationId}/messages/${messageId}/resend`, { method: 'POST' }) });

/** Reação do atendente a uma mensagem. `emoji` vazio retira. */
export const useReact = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, messageId, emoji }: { conversationId: string; messageId: string; emoji: string }) =>
      api<Message>(`/conversations/${conversationId}/messages/${messageId}/react`, { method: 'POST', body: JSON.stringify({ emoji }) }),
    // aparece na hora, mesmo se o socket estiver reconectando
    onSuccess: (m) => upsertMessageInCache(qc, m),
  });
};

/**
 * Apagar mensagem (docs/apagar-mensagens.md). `notice` preenchido = foi apagada só no painel
 * (Meta, prazo do WhatsApp, recebida…) e a tela precisa dizer isso ao atendente.
 */
export const useDeleteMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, messageId }: { conversationId: string; messageId: string }) =>
      api<{ message: Message; forEveryone: boolean; notice: string | null }>(`/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' }),
    onSuccess: (r) => { upsertMessageInCache(qc, r.message); qc.invalidateQueries({ queryKey: ['conversation-events', r.message.conversationId] }); },
  });
};

/** Editar a própria mensagem de texto (docs/editar-mensagens.md). */
export const useEditMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, messageId, text }: { conversationId: string; messageId: string; text: string }) =>
      api<Message>(`/conversations/${conversationId}/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ text }) }),
    onSuccess: (m) => { upsertMessageInCache(qc, m); qc.invalidateQueries({ queryKey: ['conversation-events', m.conversationId] }); qc.invalidateQueries({ queryKey: ['conversations'] }); },
  });
};

/** Conteúdo original de uma apagada. Só busca quando quem audita pede para ver. */
export const useDeletedOriginal = (m: Pick<Message, 'id' | 'conversationId'>, enabled: boolean) =>
  useQuery({
    queryKey: ['deleted-original', m.id],
    enabled,
    queryFn: () => api<DeletedMessageOriginal>(`/conversations/${m.conversationId}/messages/${m.id}/original`),
    // URL de mídia assinada expira: não guardar por muito tempo
    staleTime: 60_000,
  });

/** Limpar o histórico da conversa (só no painel). */
export const useClearHistory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => api<{ cleared: number; cancelled: number }>(`/conversations/${conversationId}/messages`, { method: 'DELETE' }),
    onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ['messages', id] }); invConv(qc, id); qc.invalidateQueries({ queryKey: ['conversation-events', id] }); },
  });
};

/**
 * Encaminha uma mensagem para outras conversas. Cada destino é um envio normal; os que falharem
 * voltam em `failed` (sem posse, fora da janela da Meta, número desconectado…).
 */
export const useForwardMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, messageId, targetConversationIds }: { conversationId: string; messageId: string; targetConversationIds: string[] }) =>
      api<{ sent: Message[]; failed: { conversationId: string; error: string }[] }>(`/conversations/${conversationId}/messages/${messageId}/forward`, { method: 'POST', body: JSON.stringify({ targetConversationIds }) }),
    onSuccess: (r) => { r.sent.forEach((m) => upsertMessageInCache(qc, m)); qc.invalidateQueries({ queryKey: ['usage'] }); },
  });
};

/** Upload multipart: passa pelo `api` (que já trata FormData) para ganhar o refresh do token. */
export const uploadFile = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api<Upload>('/uploads', { method: 'POST', body: form });
};

export const mediaTypeOf = (mime: string): 'image' | 'audio' | 'video' | 'document' =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'document';

export const useSetStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status: ConversationStatus; outcome?: ConversationOutcome; value?: number; reason?: string; products?: string; items?: { description: string; value: number }[]; notes?: string; flowId?: string | null }) => api(`/conversations/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (_, v) => {
      // sai na hora das listas de outro status (sem esperar o refetch) e a aberta já vê o novo status
      for (const [key] of qc.getQueriesData<Conversation[]>({ queryKey: ['conversations'] })) {
        if ((key[1] as { status?: ConversationStatus } | undefined)?.status === v.status) continue;
        qc.setQueryData<Conversation[]>(key, (old) => old?.filter((c) => c.id !== v.id));
      }
      qc.setQueryData<Conversation>(['conversation', v.id], (old) => (old ? { ...old, status: v.status } : old));
      invConv(qc, v.id);
    },
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
  /** em plano anual, o equivalente mensal */
  priceMonth: number;
  priceYear: number | null;
  isFree: boolean;
  billingCycle: BillingCycle;
  /** dias de gratuidade; null em plano gratuito = permanente */
  durationDays: number | null;
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
  priceYear?: number | null;
  isFree?: boolean;
  billingCycle?: BillingCycle;
  durationDays?: number | null;
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
  type: 'claimed' | 'transferred' | 'released' | 'closed' | 'reopened' | 'bot_paused' | 'bot_resumed' | 'department_changed' | 'message_deleted' | 'history_cleared' | 'message_edited';
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
    mutationFn: ({ contactId, ...b }: { contactId: string; name?: string; email?: string; address?: string; note1?: string; note2?: string; resubscribe?: true }) => api(`/conversations/contacts/${contactId}`, { method: 'PATCH', body: JSON.stringify(b) }),
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
