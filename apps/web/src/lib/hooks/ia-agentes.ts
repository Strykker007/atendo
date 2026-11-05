'use client';
/** Agentes de IA com etapas — docs/agente-ia.md. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentTurn, AiAgent, AiAgentConfig } from '@atendo/shared';
import { api } from '../api';

export interface AgentCatalog {
  departments: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  closeReasons: { id: string; name: string }[];
  /** rótulos dos campos personalizados da ficha */
  customFields: string[];
}

export const useAiAgents = (enabled = true) => useQuery({ queryKey: ['ai-agents'], enabled, queryFn: () => api<AiAgent[]>('/ai/agents') });
export const useAiAgent = (id: string | null) => useQuery({ queryKey: ['ai-agents', id], enabled: !!id, queryFn: () => api<AiAgent>(`/ai/agents/${id}`) });
export const useAgentCatalog = () => useQuery({ queryKey: ['ai-agents', 'catalog'], queryFn: () => api<AgentCatalog>('/ai/agents/catalog') });

export const useSaveAiAgent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: Partial<AiAgentConfig> & { id?: string }) => api<AiAgent>(id ? `/ai/agents/${id}` : '/ai/agents', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ['ai-agents'] }); qc.setQueryData(['ai-agents', a.id], a); },
  });
};
export const useDeleteAiAgent = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/ai/agents/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-agents'] }) });
};
/** Simulador: resposta, etapa e ações que o agente pediria. Nada é executado. */
export const useSimulateAgent = () =>
  useMutation({
    mutationFn: ({ id, ...b }: { id: string; messages: { from: 'contact' | 'agent'; text: string }[]; stageId?: string }) => api<AgentTurn>(`/ai/agents/${id}/simulate`, { method: 'POST', body: JSON.stringify(b) }),
  });
