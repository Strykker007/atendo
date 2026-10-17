'use client';
/** Importar e exportar a base de contatos (planilha). */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, getAccessToken, refresh } from '../api';
import { useUI } from '../store';

export interface ContactImportReport {
  total: number; created: number; updated: number; unchanged: number; duplicates: number;
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
