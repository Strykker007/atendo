'use client';
/** Foto protegida: a imagem vai por link com validade, não pelo WhatsApp (docs/foto-protegida.md). */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SecureMediaStatus } from '@atendo/shared';
import { api } from '../api';

export interface SecureMediaItem {
  id: string;
  hash: string;
  status: SecureMediaStatus;
  mimeType: string;
  fileName: string | null;
  caption: string | null;
  validHours: number;
  expiresAt: string;
  revokedAt: string | null;
  firstViewedAt: string | null;
  viewCount: number;
  createdAt: string;
  user: { id: string; name: string };
  /** URL assinada para a equipe — continua valendo depois de expirar para o contato */
  url: string;
}

/** Link público — no domínio aberto agora, para sair com a marca certa (igual ao orçamento). */
export const secureMediaLink = (hash: string) => `${typeof window === 'undefined' ? '' : window.location.origin}/f/${hash}`;
/** Acha o hash de uma foto protegida dentro do texto de uma mensagem. */
export const secureMediaHashIn = (text?: string | null) => text?.match(/\/f\/([A-Za-z0-9_-]{22})\b/)?.[1] ?? null;

export const useSecureMedia = (conversationId: string | null, enabled = true) =>
  useQuery({
    queryKey: ['secure-media', conversationId],
    enabled: !!conversationId && enabled,
    queryFn: () => api<SecureMediaItem[]>(`/conversations/${conversationId}/secure-media`),
    staleTime: 30_000,
  });

export const useCreateSecureMedia = () => {
  const qc = useQueryClient();
  return useMutation({
    // `linkBase`: o link sai no domínio aberto agora; a API devolve em `text` a frase da empresa pronta
    mutationFn: ({ conversationId, ...body }: { conversationId: string; mediaKey: string; mimeType: string; fileName?: string; caption?: string; validHours: number }) =>
      api<SecureMediaItem & { text: string }>(`/conversations/${conversationId}/secure-media`, { method: 'POST', body: JSON.stringify({ ...body, linkBase: window.location.origin }) }),
    onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['secure-media', v.conversationId] }),
  });
};

export const useRevokeSecureMedia = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, id }: { conversationId: string; id: string }) => api<SecureMediaItem>(`/conversations/${conversationId}/secure-media/${id}/revoke`, { method: 'POST' }),
    onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['secure-media', v.conversationId] }),
  });
};
