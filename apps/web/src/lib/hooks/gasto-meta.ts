'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

/** Gasto com a API oficial da Meta (docs/gasto-meta.md). */
export interface MetaCosts {
  period: string;
  hasMeta: boolean;
  /** orçamento mensal em reais; null = sem orçamento */
  budget: number | null;
  /** estimativa do Atendo, em reais, na hora */
  estimated: number;
  /** o que a Meta apurou (moeda da WABA), com algumas horas de atraso; null = ainda não leu */
  real: { currency: string; total: number; updatedAt: string | null; currencies: number } | null;
  projection: number | null;
  byCategory: {
    estimated: { category: string; count: number; cost: number }[];
    real: { category: string; type: string; volume: number; cost: number }[];
  };
  byNumber: { numberId: string; label: string; phone: string; isActive: boolean; estimated: number; real: number | null }[];
  byDay: { day: string; estimated: number; real: number | null }[];
}

export const useMetaCosts = (period: string, enabled = true) =>
  useQuery({ queryKey: ['meta-costs', period], queryFn: () => api<MetaCosts>(`/billing/meta-costs?period=${period}`), enabled, placeholderData: keepPreviousData, retry: false });

export function useMetaCostsWrite() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['meta-costs'] });
  return {
    refresh: useMutation({ mutationFn: () => api<{ ok: true }>('/billing/meta-costs/refresh', { method: 'POST' }), onSuccess: done }),
    budget: useMutation({ mutationFn: (budget: number | null) => api<{ budget: number | null }>('/billing/meta-budget', { method: 'PATCH', body: JSON.stringify({ budget }) }), onSuccess: done }),
  };
}
