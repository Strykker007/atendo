'use client';
/** Variáveis da empresa (`{{pix_chave}}`, `{{global.link_catalogo}}`…) — docs/variaveis.md. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export interface GlobalVariable { id: string; key: string; label: string; value: string; updatedAt: string }
type Body = { label: string; key?: string; value: string };

const KEY = ['global-variables'];
const BASE = '/tenants/me/global-variables';

export const useGlobalVariables = () =>
  useQuery({ queryKey: KEY, queryFn: () => api<GlobalVariable[]>(BASE), staleTime: 60_000 });

// a lista é uma só para o sistema todo (menus de fluxo, respostas rápidas, chat, Configurações)
export const useCreateGlobalVariable = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Body) => api<GlobalVariable>(BASE, { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: (v) => { qc.setQueryData<GlobalVariable[]>(KEY, (old) => old && [...old, v].sort((a, b) => a.label.localeCompare(b.label))); qc.invalidateQueries({ queryKey: KEY }); },
  });
};
export const useUpdateGlobalVariable = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...b }: Partial<Body> & { id: string }) => api<GlobalVariable>(`${BASE}/${id}`, { method: 'PUT', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
};
export const useDeleteGlobalVariable = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`${BASE}/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
};
