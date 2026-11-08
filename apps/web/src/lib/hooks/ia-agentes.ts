'use client';
/** Agentes de IA com etapas — docs/agente-ia.md. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentKnowledgeDoc, AgentTurn, AiAgent, AiAgentConfig, KnowledgeHit } from '@atendo/shared';
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

// ---------- documentos do agente (docs/agente-ia.md#documentos) ----------

export interface AgentDocs { semantic: boolean; docs: AgentKnowledgeDoc[] }

/** Lista os documentos. Enquanto a busca por significado está sendo gerada, confere de novo a cada 4 s. */
export const useAgentDocs = (id: string) =>
  useQuery({
    queryKey: ['ai-agents', id, 'docs'],
    queryFn: () => api<AgentDocs>(`/ai/agents/${id}/knowledge`),
    refetchInterval: (q) => (q.state.data?.semantic && q.state.data.docs.some((d) => d.status === 'ready' && d.embedded < d.chunks) ? 4000 : false),
  });

export const useUploadAgentDoc = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<{ id: string; chunks: number; semantic: boolean }>(`/ai/agents/${id}/knowledge`, { method: 'POST', body: form });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-agents', id, 'docs'] }),
  });
};

export const useDeleteAgentDoc = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api(`/ai/agents/${id}/knowledge/${docId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-agents', id, 'docs'] }),
  });
};

/** Testar a busca: os trechos que o agente leria para esta pergunta. Não gasta interação. */
export const useSearchAgentDocs = (id: string) =>
  useMutation({ mutationFn: (q: string) => api<KnowledgeHit[]>(`/ai/agents/${id}/knowledge/search`, { method: 'POST', body: JSON.stringify({ q }) }) });

// ---------- exportar / importar (docs/20-modelos-de-perfil.md) ----------

/** Todos os agentes no formato portável (o mesmo arquivo cabe no modelo de perfil). */
export const useExportAiAgents = () =>
  useMutation({ mutationFn: () => api<{ bundle: { atendo: string; items: unknown[] }; warnings: string[] }>('/ai/agents/export') });

export const useImportAiAgents = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (portable: unknown) => api<{ created: string[]; skipped: string[]; warnings: string[] }>('/ai/agents/import', { method: 'POST', body: JSON.stringify({ portable }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-agents'] }),
  });
};
