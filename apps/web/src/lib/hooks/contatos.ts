'use client';
/** Importar e exportar a base de contatos (planilha). */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ConversationStatus } from '@atendo/shared';
import type { Conversation } from './core';
import { api, ApiError, getAccessToken, refresh } from '../api';
import { useUI } from '../store';

export interface ContactImportReport {
  total: number; created: number; updated: number; unchanged: number; duplicates: number;
  /** já existiam em outro condomínio/empresa: não alterados */
  outOfScope?: number;
  invalid: { line: number; value: string; reason: string }[]; invalidCount: number;
  unknownTags: string[]; dryRun: boolean;
}
/** `csv` = conteúdo do .csv; `rows` = .xlsx já lido no navegador (lib/xlsx-read.ts) */
export type ContactImportBody = { csv?: string; rows?: string[][]; overwrite?: boolean; dryRun?: boolean };

export const useImportContacts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: ContactImportBody) => api<ContactImportReport>('/contacts/import', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: (r) => { if (!r.dryRun) { qc.invalidateQueries({ queryKey: ['conversations'] }); qc.invalidateQueries({ queryKey: ['start-candidates'] }); } },
  });
};

/**
 * Baixa o CSV da base. Não passa por `api()` (que lê JSON): o corpo é a planilha. Mesmo
 * cabeçalho de autenticação, com uma renovação do token se ele venceu.
 */
export async function downloadContactsCsv() {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const call = () => {
    const token = getAccessToken();
    const companyId = useUI.getState().companyId;
    return fetch(`${base}/contacts/export`, { credentials: 'include', headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(companyId && { 'x-company-id': companyId }) } });
  };
  let res = await call();
  if (res.status === 401 && (await refresh())) res = await call();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Erro ${res.status}`, res.status, body.code);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `contatos-${new Date().toLocaleDateString('en-CA')}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Linha da tela Contatos: a ficha + a conversa mais recente no escopo de quem vê (ação "Abrir conversa"). */
export type ContactRow = Conversation['contact'] & {
  lastConversation: { id: string; status: ConversationStatus; lastMessageAt: string | null; number: { id: string; label: string }; assignee: { id: string; name: string } | null } | null;
};

/** Base de contatos que a pessoa enxerga, com busca no servidor, de 50 em 50. */
export const useContactsList = (q: string) =>
  useInfiniteQuery({
    queryKey: ['contacts-list', q],
    queryFn: ({ pageParam }) => api<{ items: ContactRow[]; nextCursor: string | null }>(`/conversations/contacts?q=${encodeURIComponent(q)}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
