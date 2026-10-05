'use client';
/** Departamentos (Vendas, Suporte…): cadastro, participantes e transferência da conversa. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { invConv, type Conversation } from './core';

export interface Department {
  id: string; name: string; description: string | null; color: string; isActive: boolean; createdAt: string;
  users: { user: { id: string; name: string; isActive: boolean } }[];
  /** conversas abertas (não encerradas) no departamento */
  _count: { conversations: number };
}
export type DepartmentInput = { name: string; description?: string | null; color?: string; isActive?: boolean; userIds?: string[] };

export const useDepartments = () => useQuery({ queryKey: ['departments'], queryFn: () => api<Department[]>('/departments'), staleTime: 60_000 });

const invDepartments = (qc: ReturnType<typeof useQueryClient>) => () => {
  qc.invalidateQueries({ queryKey: ['departments'] });
  qc.invalidateQueries({ queryKey: ['agents'] });
  // participantes mudaram = o que cada um enxerga mudou
  qc.invalidateQueries({ queryKey: ['conversations'] });
  qc.invalidateQueries({ queryKey: ['conversation-counts'] });
};
export const useCreateDepartment = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: DepartmentInput) => api<Department>('/departments', { method: 'POST', body: JSON.stringify(b) }), onSuccess: invDepartments(qc) }); };
export const useUpdateDepartment = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: Partial<DepartmentInput> & { id: string }) => api<Department>(`/departments/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: invDepartments(qc) }); };
export const useDeleteDepartment = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api(`/departments/${id}`, { method: 'DELETE' }), onSuccess: invDepartments(qc) }); };

/** Transferir a conversa para outro departamento (null = tirar de departamento). Vai para a fila dele. */
export const useSetConversationDepartment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, departmentId }: { id: string; departmentId: string | null }) => api<Conversation>(`/conversations/${id}/department`, { method: 'PATCH', body: JSON.stringify({ departmentId }) }),
    onSuccess: (_, v) => { invConv(qc, v.id); qc.invalidateQueries({ queryKey: ['conversation-events', v.id] }); },
  });
};
