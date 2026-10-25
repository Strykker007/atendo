'use client';
/** Motivos de encerramento (lista da empresa, separada das tags) — docs/06-modelo-de-dados.md#encerramento. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export type CloseReasonOutcome = 'won' | 'lost' | 'both';
/** `ignoreInReports`: motivo de atendimento interno — só no encerramento interno, e o atendimento sai dos relatórios */
export interface CloseReason { id: string; name: string; color: string; outcome: CloseReasonOutcome; ignoreInReports: boolean; requiresTag: boolean; position: number; isActive: boolean }

const KEY = ['close-reasons'];
export const useCloseReasons = () => useQuery({ queryKey: KEY, queryFn: () => api<CloseReason[]>('/close-reasons'), staleTime: 60_000 });
/** ativos que valem para o resultado (o do resultado + os de "ambos"); `internal` = os de atendimento interno */
export const reasonsFor = (list: CloseReason[] | undefined, outcome: 'won' | 'lost' | 'internal' | null) =>
  (list ?? []).filter((r) => r.isActive && !!outcome && (outcome === 'internal' ? r.ignoreInReports : !r.ignoreInReports && (r.outcome === outcome || r.outcome === 'both')));

const inv = (qc: ReturnType<typeof useQueryClient>) => () => qc.invalidateQueries({ queryKey: KEY });
export const useCreateCloseReason = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { name: string; color?: string; outcome?: CloseReasonOutcome; ignoreInReports?: boolean; requiresTag?: boolean }) => api<CloseReason>('/close-reasons', { method: 'POST', body: JSON.stringify(b) }), onSuccess: inv(qc) });
};
export const useUpdateCloseReason = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; color?: string; outcome?: CloseReasonOutcome; isActive?: boolean; ignoreInReports?: boolean; requiresTag?: boolean }) => api<CloseReason>(`/close-reasons/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: inv(qc) });
};
export const useDeleteCloseReason = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/close-reasons/${id}`, { method: 'DELETE' }), onSuccess: inv(qc) });
};
export const useReorderCloseReasons = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api('/close-reasons/order', { method: 'PATCH', body: JSON.stringify({ ids }) }),
    onMutate: (ids) => qc.setQueryData<CloseReason[]>(KEY, (old) => old && [...ids.map((id) => old.find((r) => r.id === id)).filter((r): r is CloseReason => !!r), ...old.filter((r) => !ids.includes(r.id))]),
    onSettled: inv(qc),
  });
};

/** Auditoria (`GET /audit-logs`, só com `profiles.manage`): encerramentos internos, do mais recente. */
export interface AuditLogRow { id: string; action: string; actorId: string | null; actorName: string | null; entityId: string; contactId: string | null; contactName: string | null; data: { reason?: string | null; bulk?: boolean } | null; createdAt: string }
export const useInternalCloseAudit = (enabled: boolean, page = 1, f: { from?: string; to?: string; actorId?: string } = {}) =>
  useQuery({
    queryKey: ['audit-logs', 'conversation.closed_internal', page, f],
    queryFn: () => {
      const q = new URLSearchParams({ action: 'conversation.closed_internal', page: String(page), pageSize: '25' });
      if (f.from) q.set('from', f.from);
      if (f.to) q.set('to', f.to);
      if (f.actorId) q.set('actorId', f.actorId);
      return api<{ total: number; page: number; pageSize: number; rows: AuditLogRow[] }>(`/audit-logs?${q}`);
    },
    enabled,
  });
