'use client';
/** Empresas/unidades (matriz, filiais): cadastro, números e pessoas de cada uma, e o seletor do menu. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export interface Company {
  id: string; name: string; cnpj: string | null; description: string | null; createdAt: string;
  numbers: { id: string; label: string; phone: string; color: string }[];
  users: { user: { id: string; name: string; isActive: boolean } }[];
}
export type CompanyInput = { name: string; cnpj?: string | null; description?: string | null; numberIds?: string[]; userIds?: string[] };

export const useCompanies = () => useQuery({ queryKey: ['companies'], queryFn: () => api<Company[]>('/companies'), staleTime: 60_000 });

/** Empresas que a pessoa pode escolher no seletor. Vazio = cliente não usa empresas (seletor some). */
export const useMyCompanies = () => useQuery({ queryKey: ['companies-mine'], queryFn: () => api<{ id: string; name: string }[]>('/companies/mine'), staleTime: 60_000 });

/** Empresa mudou de números ou de pessoas = o que cada um enxerga mudou: recarrega tudo. */
const invCompanies = (qc: ReturnType<typeof useQueryClient>) => () => { qc.invalidateQueries(); };
export const useCreateCompany = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: CompanyInput) => api<Company>('/companies', { method: 'POST', body: JSON.stringify(b) }), onSuccess: invCompanies(qc) }); };
export const useUpdateCompany = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: Partial<CompanyInput> & { id: string }) => api<Company>(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: invCompanies(qc) }); };
export const useDeleteCompany = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/companies/${id}`, { method: 'DELETE' }), onSuccess: invCompanies(qc) }); };
