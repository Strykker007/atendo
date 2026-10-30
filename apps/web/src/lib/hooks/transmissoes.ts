'use client';
/** Transmissões (envio em massa) — docs/envio.md#transmissão. */
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api';
import type { TemplateChoice } from '@atendo/shared';

/** Público: filtros (E) + seleção manual e telefones importados (somam). Sem critério, só com `all`. */
export interface CampaignAudience {
  all?: boolean;
  /** tags atuais do contato (📌 ou de alguma conversa dele) */
  tagIds?: string[];
  /** tags escolhidas em encerramentos no período */
  closingTagIds?: string[];
  closingFrom?: string;
  closingTo?: string;
  /** resultado do último atendimento encerrado */
  lastOutcome?: 'won' | 'lost';
  agentId?: string;
  contactIds?: string[];
  phones?: string[];
  /** grupos autorizados (docs/grupos.md) — só QR Code */
  groupIds?: string[];
}
export interface CampaignStats { total: number; pending: number; sent: number; delivered: number; read: number; failed: number; skipped: number }
export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'done' | 'canceled';
export type CampaignTemplateChoice = TemplateChoice;
export interface Campaign {
  id: string;
  name: string;
  numberId: string;
  text: string;
  mediaKey: string | null;
  mediaType: string | null;
  mediaName: string | null;
  template: CampaignTemplateChoice | null;
  status: CampaignStatus;
  startAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  businessHoursOnly: boolean;
  audience: CampaignAudience | null;
  riskAcceptedAt: string | null;
  pauseReason: string | null;
  number: { label: string; provider: 'meta' | 'evolution'; phone?: string; id?: string };
  stats: CampaignStats;
}
export interface CampaignDetail extends Campaign {
  /** teto de transmissão do número nas últimas 24h (`limit` null = API oficial, sem teto nosso) */
  daily: { sent: number; limit: number | null };
  problemas: { contato: string; status: string; motivo: string | null }[];
}
export interface AudiencePreview { total: number; novos: number; invalidos: number; optOut: number; excedeu: boolean; max: number; /** grupos autorizados escolhidos */ groups?: number }
export interface NewCampaign {
  name: string;
  numberId: string;
  text?: string;
  mediaKey?: string;
  mediaType?: string;
  mediaName?: string;
  template?: CampaignTemplateChoice;
  startAt?: string;
  businessHoursOnly?: boolean;
  audience: CampaignAudience;
}

const ativa = (s: CampaignStatus) => s === 'running' || s === 'scheduled';

// o socket (`campaign`) invalida a cada lote; o intervalo é rede de segurança se ele cair
export const useCampaigns = () =>
  useQuery({ queryKey: ['campaigns'], queryFn: () => api<Campaign[]>('/campaigns'), refetchInterval: (q) => (q.state.data?.some((c) => ativa(c.status)) ? 30_000 : false) });
export const useCampaign = (id: string | null) =>
  useQuery({ queryKey: ['campaign', id], enabled: !!id, queryFn: () => api<CampaignDetail>(`/campaigns/${id}`), refetchInterval: (q) => (q.state.data && ativa(q.state.data.status) ? 30_000 : false) });
export const useAudiencePreview = (a: CampaignAudience, enabled: boolean) =>
  useQuery({ queryKey: ['campaign-preview', JSON.stringify(a)], enabled, placeholderData: keepPreviousData, queryFn: () => api<AudiencePreview>('/campaigns/preview', { method: 'POST', body: JSON.stringify(a) }) });

/** Previsão antes de disparar pela API oficial (docs/gasto-meta.md#transmissão). */
export interface CampaignEstimate {
  provider: 'meta' | 'evolution';
  recipients: number;
  category: string | null;
  unitPrice: number;
  total: number;
  plan: { included: number | null; remaining: number | null; hardLimit: boolean; overageCount: number; overagePrice: number | null } | null;
  month: { spent: number; budget: number | null; after: number } | null;
  blockers: string[];
  warnings: string[];
}

/** transmissão ainda na tela: número + público + template (só faz sentido na API oficial) */
export const useCampaignEstimate = (b: { numberId: string; audience: CampaignAudience; template?: { name: string; language: string } }, enabled: boolean) =>
  useQuery({
    queryKey: ['campaign-estimate', JSON.stringify(b)],
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () => api<CampaignEstimate>('/campaigns/estimate', { method: 'POST', body: JSON.stringify(b) }),
  });

/** transmissão salva (rascunho): os alvos que ainda faltam */
export const useSavedCampaignEstimate = (id: string | null) =>
  useQuery({ queryKey: ['campaign-estimate', id], enabled: !!id, retry: false, queryFn: () => api<CampaignEstimate>(`/campaigns/${id}/estimate`) });

export const useCreateCampaign = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: NewCampaign) => api<Campaign>('/campaigns', { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }) });
};
export const useStartCampaign = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, acceptRisk }: { id: string; acceptRisk?: boolean }) => api<Campaign>(`/campaigns/${id}/start`, { method: 'POST', body: JSON.stringify({ acceptRisk }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }) });
};
export const useCampaignStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'paused' | 'running' | 'canceled' }) => api<Campaign>(`/campaigns/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['campaigns'] }); qc.invalidateQueries({ queryKey: ['campaign', v.id] }); },
  });
};
