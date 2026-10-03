'use client';
/** Números de WhatsApp. */
'use client';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onAccessToken } from '../api';
import type { ConversationStatus, PlanLimits, FlowDefinition, FlowTrigger, Permission } from '@atendo/shared';
import { ALL_PERMISSIONS } from '@atendo/shared';
import { Message, NumberItem, ProviderConfig, SendDelayProfile, SendingStatus, upsertMessageInCache } from './core';

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
    mutationFn: ({ id, ...body }: { id: string; label?: string; isActive?: boolean; sendDelay?: SendDelayProfile; sendDailyLimit?: number; infraCostMonth?: number }) => api(`/numbers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
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
    socket.on('message', (m: Message) => upsertMessageInCache(qc, m));
    socket.on('conversation', (c: { id: string }) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation', c.id] });
      qc.invalidateQueries({ queryKey: ['conversation-counts'] });
      qc.invalidateQueries({ queryKey: ['active-run', c.id] });
    });
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
