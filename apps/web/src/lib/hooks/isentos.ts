'use client';
/** Contatos isentos de ticket — docs/contatos-isentos.md. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export interface IgnoredContact {
  id: string;
  /** só dígitos, com DDI */
  phone: string;
  label: string | null;
  createdAt: string;
  /** contato do painel com este telefone, se já existir */
  contact: { id: string; name: string | null; phone: string } | null;
}

export const useIgnoredContacts = () => useQuery({ queryKey: ['ignored-contacts'], queryFn: () => api<IgnoredContact[]>('/ignored-contacts') });

/** Entrar/sair da lista muda as conversas existentes (viram/deixam de ser livres). */
const invalidar = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['ignored-contacts'] });
  qc.invalidateQueries({ queryKey: ['conversations'] });
  qc.invalidateQueries({ queryKey: ['conversation-counts'] });
};

export const useAddIgnoredContact = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { phone?: string; contactId?: string; label?: string }) => api<IgnoredContact>('/ignored-contacts', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => invalidar(qc),
  });
};

export const useRemoveIgnoredContact = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/ignored-contacts/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidar(qc),
  });
};

/** Atalho da conversa/card: tira da lista pelo contato (sem precisar do id do registro). */
export const useRemoveIgnoredByContact = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) => api<{ ok: boolean }>(`/ignored-contacts/contact/${contactId}`, { method: 'DELETE' }),
    onSuccess: () => invalidar(qc),
  });
};
