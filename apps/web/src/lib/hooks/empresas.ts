'use client';
/** Empresas/unidades (matriz, filiais): cadastro, números e pessoas de cada uma, e o seletor do menu. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export interface Company {
  id: string; name: string; cnpj: string | null; description: string | null; createdAt: string;
  /** CONSOLIDATED_GROUP = herda a assinatura do cliente; INDIVIDUAL = assinatura própria */
  billingType: 'INDIVIDUAL' | 'CONSOLIDATED_GROUP';
  /** ativa para cobrança */
  isActive: boolean;
  subscription: { planId: string; status: string; currentPeriodEnd: string; priceMonth: string | null; plan: { name: string } } | null;
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

// ---- Dono (super_admin): empresas de qualquer cliente, sem "Entrar como" ----
const adminBase = (tenantId: string) => `/admin/tenants/${tenantId}/companies`;
export interface CompanyOptions { numbers: { id: string; label: string; phone: string }[]; users: { id: string; name: string; isActive: boolean }[]; maxCompanies: number | null }
export const useAdminCompanies = (tenantId: string) => useQuery({ queryKey: ['admin-companies', tenantId], queryFn: () => api<Company[]>(adminBase(tenantId)) });
export const useAdminCompanyOptions = (tenantId: string) => useQuery({ queryKey: ['admin-companies-options', tenantId], queryFn: () => api<CompanyOptions>(`${adminBase(tenantId)}/options`) });
const invAdmin = (qc: ReturnType<typeof useQueryClient>, tenantId: string) => () => { qc.invalidateQueries({ queryKey: ['admin-companies', tenantId] }); qc.invalidateQueries({ queryKey: ['tenants'] }); };
export const useAdminCreateCompany = (tenantId: string) => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: CompanyInput) => api<Company>(adminBase(tenantId), { method: 'POST', body: JSON.stringify(b) }), onSuccess: invAdmin(qc, tenantId) }); };
export const useAdminUpdateCompany = (tenantId: string) => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: Partial<CompanyInput> & { id: string }) => api<Company>(`${adminBase(tenantId)}/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: invAdmin(qc, tenantId) }); };
export interface CompanyBillingInput { id: string; billingType: 'INDIVIDUAL' | 'CONSOLIDATED_GROUP'; isActive?: boolean; planId?: string; priceMonth?: number | null; /** AAAA-MM-DD */ currentPeriodEnd?: string; status?: string }
export const useAdminCompanyBilling = (tenantId: string) => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: CompanyBillingInput) => api<Company>(`${adminBase(tenantId)}/${id}/billing`, { method: 'PUT', body: JSON.stringify(b) }), onSuccess: invAdmin(qc, tenantId) }); };
export const useAdminDeleteCompany = (tenantId: string) => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`${adminBase(tenantId)}/${id}`, { method: 'DELETE' }), onSuccess: invAdmin(qc, tenantId) }); };
