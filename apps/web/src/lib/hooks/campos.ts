'use client';
/** Campos livres da ficha, por contato (cada cliente tem os seus). */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export type ContactAttributeType = 'text' | 'number' | 'date';
export interface ContactAttribute { id?: string; label: string; type: ContactAttributeType; value: string }

export const useContactAttributes = (contactId: string) =>
  useQuery({ queryKey: ['contact-attributes', contactId], queryFn: () => api<ContactAttribute[]>(`/contact-attributes/${contactId}`) });

/** Nomes já usados em outros contatos: sugestão ao digitar. */
export const useContactAttributeLabels = () =>
  useQuery({ queryKey: ['contact-attribute-labels'], queryFn: () => api<{ label: string; type: ContactAttributeType }[]>('/contact-attributes/labels'), staleTime: 60_000 });

export const useSetContactAttributes = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, items }: { contactId: string; items: ContactAttribute[] }) =>
      api<ContactAttribute[]>(`/contact-attributes/${contactId}`, { method: 'PUT', body: JSON.stringify({ items: items.map(({ label, type, value }) => ({ label, type, value })) }) }),
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ['contact-attributes', v.contactId] }); qc.invalidateQueries({ queryKey: ['contact-attribute-labels'] }); },
  });
};
