'use client';
/** Números de WhatsApp. */
'use client';
import { keepPreviousData, useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken, refresh, refreshRefused } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission, TypingEvent, SendLimits } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';
import { Conversation, Message, NumberItem, ProviderConfig, SendDelayProfile, SendingStatus, Typing, invConv, upsertMessageInCache, dropConversationFromCache } from './core';
import type { MessageTemplate, TemplateValues } from '@atendo/shared';
import { receiveSystemNotice, type SystemNotice } from './avisos';
import { playMessageSound, unlockMessageSound } from '../message-sound';
import { useUI } from '../store';
import { toast } from '@/components/ui/Toast';
import { receiveTransferAlert, type TransferAlertEvent } from '@/components/layout/TransferAlert';
import { upsertInternalMessage, type InternalMessage } from './chat-interno';
import { create } from 'zustand';

/**
 * Estado do socket do tempo real, para a faixa "reconectando" (components/layout/RealtimeBanner).
 * `downSince` = desde quando está fora; null = conectado (ou ainda não tentou).
 */
export const useRealtimeStatus = create<{ downSince: number | null }>(() => ({ downSince: null }));

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
    // `force`: reconectar durante a pausa após queda forçada pelo WhatsApp (409 reconnect_paused)
    mutationFn: (v: string | { id: string; force?: boolean }) => {
      const { id, force } = typeof v === 'string' ? { id: v, force: undefined } : v;
      return api<NumberItem & { qrCode?: string }>(`/numbers/${id}/connect`, { method: 'POST', body: JSON.stringify({ force }) });
    },
    onSuccess: invalidateNumbers(qc),
  });
};
export const useUpdateNumber = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; label?: string; color?: string; isActive?: boolean; sendDelay?: SendDelayProfile; sendDailyLimit?: number; campaignDailyLimit?: number; endWarmup?: boolean; sendLimits?: Partial<SendLimits> | null; infraCostMonth?: number }) => api(`/numbers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: invalidateNumbers(qc),
  });
};
/** Quanto o número já enviou hoje e qual o teto vigente (com aquecimento). */
export const useSendingStatus = (id: string | null) => useQuery({ queryKey: ['sending', id], enabled: !!id, refetchInterval: 60_000, queryFn: () => api<SendingStatus>(`/numbers/${id}/sending`) });
export const useDeleteNumber = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/numbers/${id}`, { method: 'DELETE' }), onSuccess: invalidateNumbers(qc) });
};
/** Desconecta a sessão (logout na Evolution) sem excluir o número nem as conversas. */
export const useDisconnectNumber = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/numbers/${id}/disconnect`, { method: 'POST' }), onSuccess: invalidateNumbers(qc) });
};
/** Reinicia a conexão sem QR (Evolution): fecha e reabre a sessão com as mesmas credenciais. */
export const useRestartNumber = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/numbers/${id}/restart`, { method: 'POST' }), onSuccess: invalidateNumbers(qc) });
};
/** QR code mais recente por número, alimentado pelo socket (evento `number`). */
export const useNumberQr = (id: string | null) => useQuery({ queryKey: ['number-qr', id], enabled: false, queryFn: () => null as string | null });

/**
 * Tudo que o socket mantém atualizado. Na volta de uma queda, o que foi emitido enquanto o socket
 * estava fora não chega nunca — recarrega tudo de uma vez (é o que antes só acontecia trocando de
 * tela, ex.: abrir o Kanban).
 */
const REALTIME_KEYS = ['conversations', 'conversation-counts', 'conversation', 'messages', 'kanban', 'numbers', 'internal-chats', 'internal-messages', 'support-chats', 'scheduled-messages-all', 'budgets-all'];

/** Tempo real: aplica eventos do socket direto no cache do react-query. */
export function useRealtime() {
  const qc = useQueryClient();
  // reexecuta quando o token aparece (na primeira montagem ele ainda não existe) e quando muda de
  // cliente: o dono "entrando como" um cliente troca de token sem recarregar a página, e o socket
  // aberto com o token dele não está na sala do cliente — mensagem nova e status (enviado,
  // entregue, lido) não chegavam. Renovação do mesmo cliente não reconecta.
  const [sala, setSala] = useState(() => salaDoToken(getAccessToken()));
  useEffect(() => { const fora = onAccessToken((t) => setSala(salaDoToken(t))); return () => { fora(); }; }, []);
  useEffect(() => unlockMessageSound(), []);
  useEffect(() => {
    if (!getAccessToken()) return;
    // som de mensagem nova. O mesmo id volta no socket a cada mudança (status, reação, mídia
    // baixada) — toca só na primeira vez.
    const tocadas = new Set<string>();
    async function avisarChegada(m: Message) {
      tocadas.add(m.id);
      if (tocadas.size > 500) tocadas.delete(tocadas.values().next().value as string);
      // reconexão do número reimporta histórico: mensagem velha não é chegada
      if (Date.now() - new Date(m.createdAt).getTime() > 2 * 60_000) return;
      // som desligado (atalho na lista de conversas / Configurações): nem confere o escopo
      if (useUI.getState().soundMuted) return;
      // o evento vai para o tenant inteiro; só toca para quem enxerga a conversa (número,
      // empresa e departamento). Na lista em cache ela já passou pelo filtro da API; fora dela,
      // o GET da conversa aplica o mesmo escopo (404 para quem não pode ver).
      const naLista = qc.getQueriesData<Conversation[]>({ queryKey: ['conversations'] }).some(([, l]) => Array.isArray(l) && l.some((c) => c.id === m.conversationId));
      if (!naLista && !qc.getQueryData(['conversation', m.conversationId])) {
        try { await api(`/conversations/${m.conversationId}`); } catch { return; }
      }
      playMessageSound();
    }
    // Lista, contagens e quadro: o evento `conversation` chega a cada mensagem de QUALQUER conversa
    // do cliente; recarregar tudo a cada um fazia cada painel buscar a lista várias vezes por
    // segundo nas contas movimentadas (CPU a 100% em 17/10/2026). Junta e recarrega no máximo
    // uma vez a cada 2 s — a conversa aberta continua atualizando na hora.
    let listasTimer: ReturnType<typeof setTimeout> | null = null;
    let listasUltima = 0;
    const recarregarListas = () => {
      if (listasTimer) return;
      const espera = Math.max(0, listasUltima + 2000 - Date.now());
      listasTimer = setTimeout(() => {
        listasTimer = null;
        listasUltima = Date.now();
        qc.invalidateQueries({ queryKey: ['conversations'] });
        qc.invalidateQueries({ queryKey: ['conversation-counts'] });
        // tag principal, posse, status e última mensagem mudam o quadro
        qc.invalidateQueries({ queryKey: ['kanban'] });
      }, espera);
    };
    // auth como função: a cada reconexão manda o token ATUAL (o access token expira em 15 min)
    const socket: Socket = io(process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000', { auth: (cb) => cb({ token: getAccessToken() }), withCredentials: true, reconnectionDelayMax: 5000 });
    let encerrado = false;
    let jaConectou = false;
    let recuperar: ReturnType<typeof setTimeout> | null = null;
    const status = useRealtimeStatus.setState;
    socket.on('connect', () => {
      status({ downSince: null });
      // reconexão: busca o que chegou enquanto estava fora (mensagens, listas, kanban, números)
      // Espalhado em até 5 s: num deploy/reinício da API todos os painéis reconectam juntos, e
      // recarregar tudo no mesmo segundo seria um pico (a lista de conversas é a consulta mais
      // pesada). Só recarrega o que está na tela — o resto fica marcado e busca ao abrir.
      if (jaConectou) {
        if (recuperar) clearTimeout(recuperar);
        recuperar = setTimeout(() => { recuperar = null; for (const key of REALTIME_KEYS) qc.invalidateQueries({ queryKey: [key] }); }, Math.random() * 5_000);
      }
      jaConectou = true;
    });
    // Token vencido na reconexão (aba parada, notebook que dormiu, API reiniciada): o servidor
    // derruba o socket e o socket.io NÃO tenta de novo sozinho nesse caso. Antes era UMA tentativa
    // de renovar: se o refresh falhasse naquele instante (API subindo, rede oscilando), o tempo real
    // morria calado até trocar de tela. Agora insiste com espera crescente até voltar.
    let religando = false;
    async function religar() {
      if (religando || encerrado) return;
      religando = true;
      try {
        for (let espera = 2000; !encerrado && !socket.connected; espera = Math.min(espera * 2, 30_000)) {
          // `false` com 5xx/sem resposta = API fora do ar (deploy): continua tentando, com espera
          // crescente e um sorteio para os painéis não baterem juntos. 401/403 = sessão encerrada
          // de vez: para aqui (o próximo pedido à API leva ao login, ver sessionExpired)
          const ok = await refresh().catch(() => false);
          if (ok) { socket.connect(); return; }
          if (refreshRefused()) return;
          await new Promise((r) => setTimeout(r, espera * (0.75 + Math.random() * 0.5)));
        }
      } finally { religando = false; }
    }
    socket.on('disconnect', (reason) => {
      if (!encerrado) status({ downSince: useRealtimeStatus.getState().downSince ?? Date.now() });
      if (reason === 'io server disconnect') void religar();
    });
    // recusado no handshake (`socket.active` false = o socket.io desistiu): mesma recuperação
    socket.on('connect_error', () => {
      status({ downSince: useRealtimeStatus.getState().downSince ?? Date.now() });
      if (!socket.active) void religar();
    });
    // rede voltou / aba voltou a ficar visível / vigia a cada 20 s: socket parado sem ninguém
    // tentando = reconecta. Notebook que dormiu às vezes não dispara evento nenhum.
    const conferir = () => { if (!encerrado && !socket.connected && !socket.active) void religar(); };
    const aoVoltar = () => { if (document.visibilityState === 'visible') conferir(); };
    window.addEventListener('online', conferir);
    document.addEventListener('visibilitychange', aoVoltar);
    const vigia = setInterval(conferir, 20_000);
    socket.on('message', (m: Message) => {
      const nova = m.direction === 'in' && !tocadas.has(m.id);
      upsertMessageInCache(qc, m);
      if (nova) avisarChegada(m);
      // a mensagem chegou: quem estava digitando terminou (o "parou" pode vir depois ou nunca)
      if (m.direction === 'in') qc.setQueryData<Typing>(['typing', m.conversationId], null);
    });
    // histórico limpo: um evento só, a conversa recarrega já sem o conteúdo
    // conversa excluída (por outra pessoa da equipe): some da lista e fecha se estiver aberta
    socket.on('conversation_deleted', (e: { conversationId: string }) => dropConversationFromCache(qc, e.conversationId));
    socket.on('messages_cleared', (e: { conversationId: string }) => {
      qc.invalidateQueries({ queryKey: ['messages', e.conversationId] });
    });
    socket.on('typing', (e: TypingEvent) => {
      const next: Typing = e.state === 'paused' ? null : { state: e.state, at: Date.now() };
      qc.setQueryData<Typing>(['typing', e.conversationId], next);
    });
    socket.on('conversation', (c: { id: string; status?: ConversationStatus; ticketExempt?: boolean }) => {
      // encerrada (por outro atendente, pelo robô ou pelo sistema): sai na hora das listas de outro status
      if (c.status === 'closed') {
        for (const [key] of qc.getQueriesData<Conversation[]>({ queryKey: ['conversations'] })) {
          const aba = (key[1] as { status?: string } | undefined)?.status;
          // aba "Livres" mostra a conversa livre em qualquer status
          if (aba === 'closed' || (aba === 'free' && c.ticketExempt)) continue;
          qc.setQueryData<Conversation[]>(key, (old) => old?.filter((x) => x.id !== c.id));
        }
      }
      qc.invalidateQueries({ queryKey: ['conversation', c.id] });
      qc.invalidateQueries({ queryKey: ['active-run', c.id] });
      // pausa/retomada do robô entra no histórico
      qc.invalidateQueries({ queryKey: ['conversation-events', c.id] });
      recarregarListas();
    });
    // aviso global do dono do sistema: popup no topo + sino
    socket.on('system_notice', (n: SystemNotice) => receiveSystemNotice(qc, n));
    // atendimento transferido para MIM (sala só minha): alarme + aviso em destaque
    socket.on('transfer_alert', (e: TransferAlertEvent) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      receiveTransferAlert(e);
    });
    // chat interno da equipe (sala só dos membros): entra na conversa e toca para quem não escreveu
    socket.on('internal_message', (m: InternalMessage) => {
      upsertInternalMessage(qc, m);
      const eu = qc.getQueryData<{ id: string }>(['me'])?.id;
      if (m.authorId !== eu && !useUI.getState().soundMuted) playMessageSound();
    });
    socket.on('internal_chat', () => { qc.invalidateQueries({ queryKey: ['internal-chats'] }); });
    // canal de suporte, lado do dono (sala `owners`): mensagem de qualquer cliente
    socket.on('support_message', (m: InternalMessage & { fromSupport?: boolean }) => {
      upsertInternalMessage(qc, m);
      if (!m.fromSupport && !useUI.getState().soundMuted) playMessageSound();
    });
    // pedido de autorização de plantão (sala de quem pode aprovar): aviso + som; respondido = só recarrega
    socket.on('access_request', (e: { id: string; userName?: string; reason?: string; decided?: boolean }) => {
      qc.invalidateQueries({ queryKey: ['work-schedules'] });
      if (e.decided || !e.userName) return;
      toast.warn(`${e.userName} pediu autorização para entrar fora da escala${e.reason ? `: "${e.reason}"` : ''}. Responda em Escalas e plantões.`);
      if (!useUI.getState().soundMuted) playMessageSound();
    });
    socket.on('support_chat', () => { qc.invalidateQueries({ queryKey: ['support-chats'] }); });
    socket.on('kanban', () => { qc.invalidateQueries({ queryKey: ['kanban'] }); qc.invalidateQueries({ queryKey: ['tags'] }); });
    // transmissão: progresso atualiza a tela; `alert` = parou sozinha (3 falhas seguidas…) — aviso em qualquer tela
    socket.on('campaign', (e: { id: string; status: string; name?: string; alert?: string }) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['campaign', e.id] });
      if (e.alert) toast.warn(`Transmissão "${e.name ?? ''}" pausada: ${e.alert}`);
    });
    socket.on('scheduled_messages', (e: { conversationId: string }) => { qc.invalidateQueries({ queryKey: ['scheduled-messages', e.conversationId] }); qc.invalidateQueries({ queryKey: ['scheduled-messages-all'] }); });
    // `paid` = o webhook do Pix automático deu baixa: aviso em qualquer tela
    socket.on('budgets', (e: { conversationId: string; paid?: { total: number; contactName: string } }) => {
      qc.invalidateQueries({ queryKey: ['budgets', e.conversationId] });
      qc.invalidateQueries({ queryKey: ['budgets-all'] });
      // pagamento confirmado/estornado muda o selo "Pago" da lista
      qc.invalidateQueries({ queryKey: ['conversations'] });
      if (e.paid) toast.ok(`Pix recebido: ${e.paid.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${e.paid.contactName ? ` — ${e.paid.contactName}` : ''}`);
    });
    socket.on('appointment', () => { qc.invalidateQueries({ queryKey: ['appointments'] }); qc.invalidateQueries({ queryKey: ['contact-card'] }); });
    socket.on('number', (n: { id: string; status: string; qrCode?: string }) => {
      if (n.qrCode) qc.setQueryData(['number-qr', n.id], n.qrCode);
      if (n.status === 'connected') qc.setQueryData(['number-qr', n.id], null);
      qc.invalidateQueries({ queryKey: ['numbers'] });
    });
    // monitor do dono (sala `owners`): número de algum cliente mudou / alguém abriu ou fechou o painel
    socket.on('tenant_number', () => qc.invalidateQueries({ queryKey: ['tenants-live'] }));
    socket.on('tenant_presence', () => qc.invalidateQueries({ queryKey: ['tenants-live'] }));
    return () => {
      encerrado = true;
      if (listasTimer) clearTimeout(listasTimer);
      if (recuperar) clearTimeout(recuperar);
      clearInterval(vigia);
      window.removeEventListener('online', conferir);
      document.removeEventListener('visibilitychange', aoVoltar);
      socket.disconnect();
      status({ downSince: null });
    };
  }, [qc, sala]);
}

/** Cliente do token (sem validar — só decide se o socket precisa reconectar). `null` = sem token. */
function salaDoToken(t: string | null): string | null {
  if (!t) return null;
  try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).tenantId ?? 'dono'; } catch { return 'token'; }
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
    onSuccess: (r) => { upsertMessageInCache(qc, r.message); invConv(qc, r.conversationId); qc.invalidateQueries({ queryKey: ['usage'] }); qc.invalidateQueries({ queryKey: ['cold-quota'] }); },
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
/** Vagas de contato frio do número QR nas últimas 24 h (`null` no oficial). docs/envio.md#envio-frio */
export interface ColdQuota { ok: boolean; used: number; max: number; resetsAt: string | null }
export const useColdQuota = (numberId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: ['cold-quota', numberId],
    enabled: enabled && !!numberId,
    queryFn: () => api<ColdQuota | null>(`/conversations/cold-quota?numberId=${numberId}`),
    staleTime: 15_000,
  });

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
