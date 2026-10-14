'use client';
/** Pesquisa de satisfação no encerramento — docs/pesquisa-de-satisfacao.md. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SurveyExtraQuestion, SurveyScale } from '@atendo/shared';
import { api } from '../api';

export interface SatisfactionSurvey {
  id: string;
  name: string;
  scale: SurveyScale;
  question: string;
  allowDecline: boolean;
  declineLabel: string;
  askComment: boolean;
  /** até 2 além da principal, uma por vez */
  extraQuestions: SurveyExtraQuestion[];
  commentPrompt: string | null;
  thanksMessage: string | null;
  declinedMessage: string | null;
  expiresHours: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
}
export type SurveyInput = Partial<Omit<SatisfactionSurvey, 'id' | 'createdAt'>>;

const KEY = ['satisfaction-surveys'];
/** `enabled` = o plano tem `satisfaction_surveys` (sem ele a API responde 403) */
export const useSurveys = (enabled = true) => useQuery({ queryKey: KEY, queryFn: () => api<SatisfactionSurvey[]>('/satisfaction-surveys'), staleTime: 60_000, enabled });

const inv = (qc: ReturnType<typeof useQueryClient>) => () => qc.invalidateQueries({ queryKey: KEY });
export const useCreateSurvey = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: SurveyInput) => api<SatisfactionSurvey>('/satisfaction-surveys', { method: 'POST', body: JSON.stringify(b) }), onSuccess: inv(qc) });
};
export const useUpdateSurvey = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...b }: SurveyInput & { id: string }) => api<SatisfactionSurvey>(`/satisfaction-surveys/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: inv(qc) });
};
export const useDeleteSurvey = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/satisfaction-surveys/${id}`, { method: 'DELETE' }), onSuccess: inv(qc) });
};

// ---- Relatório ----
export interface SatisfactionIndicators {
  sent: number;
  answered: number;
  declined: number;
  waiting: number;
  noResponse: number;
  /** 0–100 */
  responseRate: number;
  declineRate: number;
  avg: number | null;
  satisfiedPct: number | null;
  /** só na escala de 10 */
  nps: number | null;
}
export interface SatisfactionReport {
  scale: SurveyScale;
  scales: { scale: SurveyScale; count: number }[];
  totals: SatisfactionIndicators & { failed: number; distribution: { score: number; count: number }[] };
  byAgent: (SatisfactionIndicators & { agentId: string | null; name: string })[];
  /** perguntas adicionais, cada uma na escala dela */
  extraQuestions: { questionId: string; question: string; scale: SurveyScale; answered: number; avg: number | null; satisfiedPct: number | null; nps: number | null; distribution: { score: number; count: number }[] }[];
  comments: {
    total: number;
    page: number;
    pageSize: number;
    rows: { id: string; score: number; comment: string | null; answeredAt: string | null; sentAt: string; surveyName: string; agent: { id: string | null; name: string | null } | null; conversationId: string; contact: { id: string; name: string | null; phone: string } }[];
  };
}
export interface SatisfactionFilters { enabled?: boolean; from: string; to: string; scale?: SurveyScale; surveyId?: string; agentId?: string; scoreMin?: number; scoreMax?: number; onlyComments?: boolean; page?: number }
export const useSatisfactionReport = (f: SatisfactionFilters) => {
  const qs = new URLSearchParams({ from: f.from, to: f.to });
  if (f.scale) qs.set('scale', f.scale);
  if (f.surveyId) qs.set('surveyId', f.surveyId);
  if (f.agentId) qs.set('agentId', f.agentId);
  if (f.scoreMin) qs.set('scoreMin', String(f.scoreMin));
  if (f.scoreMax) qs.set('scoreMax', String(f.scoreMax));
  if (f.onlyComments === false) qs.set('onlyComments', '0');
  if (f.page) qs.set('page', String(f.page));
  // staleTime: a API guarda 30 s; voltar à aba não dispara outra consulta
  return useQuery({ queryKey: ['satisfaction-report', qs.toString()], queryFn: () => api<SatisfactionReport>(`/reports/satisfaction?${qs}`), placeholderData: keepPreviousData, staleTime: 30_000, refetchOnWindowFocus: false, enabled: f.enabled !== false });
};
