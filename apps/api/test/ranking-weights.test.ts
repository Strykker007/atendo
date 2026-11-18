import { describe, expect, it } from 'vitest';
import {
  RANKING_METRICS,
  RANKING_METRIC_HINT,
  RANKING_METRIC_LABEL,
  RANKING_WEIGHTS_DEFAULT,
  effectiveRankingWeights,
  normalizeRankingWeights,
  rankingMetricHint,
  rankingMetricLabel,
  rankingMetricsFor,
  rankingScores,
  salesVocab,
  type RankingInput,
} from '@atendo/shared';

// docs/38-segmentos.md e docs/metas.md › Ranking
const linha = (userId: string, o: Partial<RankingInput> = {}): RankingInput => ({ userId, revenue: 0, won: 0, closed: 0, avgHandleMin: null, satisfactionAvg: null, ...o });

describe('salesVocab', () => {
  it('com venda: consultor e lead', () => {
    expect(salesVocab(true)).toEqual({ vendas: true, pessoa: 'Consultor', pessoas: 'consultores', lead: 'lead', leads: 'leads' });
  });
  it('sem venda: atendente e contato', () => {
    expect(salesVocab(false)).toEqual({ vendas: false, pessoa: 'Atendente', pessoas: 'atendentes', lead: 'contato', leads: 'contatos' });
  });
});

describe('effectiveRankingWeights', () => {
  it('com venda: pesos da empresa como estão', () => {
    expect(effectiveRankingWeights(null, true)).toEqual(RANKING_WEIGHTS_DEFAULT);
    const proprios = { revenue: 50, won: 10, conversion: 5, satisfaction: 0, handleTime: 35 };
    expect(effectiveRankingWeights(proprios, true)).toEqual(proprios);
  });

  it('sem venda: faturamento sai da conta, o resto fica', () => {
    expect(effectiveRankingWeights({ revenue: 50, won: 10, conversion: 0, satisfaction: 0, handleTime: 0 }, false)).toEqual({ revenue: 0, won: 10, conversion: 0, satisfaction: 0, handleTime: 0 });
    expect(effectiveRankingWeights(null, false)).toEqual({ ...RANKING_WEIGHTS_DEFAULT, revenue: 0 });
  });

  it('sem venda e só faturamento com peso: volta ao padrão sem faturamento (nunca tudo zero)', () => {
    const w = effectiveRankingWeights({ revenue: 50, won: 0, conversion: 0, satisfaction: 0, handleTime: 0 }, false);
    expect(w).toEqual({ ...RANKING_WEIGHTS_DEFAULT, revenue: 0 });
    expect(RANKING_METRICS.some((k) => w[k] > 0)).toBe(true);
  });

  it('entrada inválida cai no padrão antes de aplicar a regra', () => {
    expect(effectiveRankingWeights('lixo', false)).toEqual({ ...RANKING_WEIGHTS_DEFAULT, revenue: 0 });
    expect(effectiveRankingWeights({ revenue: -5, won: 500, conversion: 'x' }, true)).toEqual({ ...normalizeRankingWeights({ revenue: -5, won: 500, conversion: 'x' }) });
  });
});

describe('rótulos das métricas', () => {
  it('com venda: os de sempre', () => {
    for (const k of RANKING_METRICS) {
      expect(rankingMetricLabel(k, true, 'Comprou')).toBe(RANKING_METRIC_LABEL[k]);
      expect(rankingMetricHint(k, true, 'Comprou')).toBe(RANKING_METRIC_HINT[k]);
    }
  });

  it('sem venda: vendas e conversão levam o nome do resultado da empresa', () => {
    expect(rankingMetricLabel('won', false, 'Resolvido')).toBe('Resolvido');
    expect(rankingMetricLabel('conversion', false, 'Resolvido')).toBe('Taxa de “Resolvido”');
    expect(rankingMetricLabel('satisfaction', false, 'Resolvido')).toBe(RANKING_METRIC_LABEL.satisfaction);
    expect(rankingMetricHint('won', false, 'Resolvido')).toContain('“Resolvido”');
    expect(rankingMetricHint('handleTime', false, 'Resolvido')).toBe(RANKING_METRIC_HINT.handleTime);
    // nenhum texto sem venda fala em venda/faturamento
    for (const k of rankingMetricsFor(false)) {
      expect(rankingMetricLabel(k, false, 'Resolvido')).not.toMatch(/venda|fatur/i);
      expect(rankingMetricHint(k, false, 'Resolvido')).not.toMatch(/venda|fatur/i);
    }
  });

  it('métricas que dá para pesar: sem venda, sem faturamento', () => {
    expect(rankingMetricsFor(true)).toEqual([...RANKING_METRICS]);
    expect(rankingMetricsFor(false)).toEqual(['won', 'conversion', 'satisfaction', 'handleTime']);
  });
});

describe('rankingScores', () => {
  it('ninguém faturou: faturamento fica sem dado, não zera a nota de todos', () => {
    const notas = rankingScores([linha('a', { won: 4, closed: 5, avgHandleMin: 10 }), linha('b', { won: 2, closed: 5, avgHandleMin: 20 })], RANKING_WEIGHTS_DEFAULT, null);
    expect(notas.get('a')!.parts.revenue).toBeNull();
    // melhor em tudo que tem dado = 100
    expect(notas.get('a')!.score).toBe(100);
    expect(notas.get('b')!.score).toBeLessThan(100);
  });

  it('ninguém fechou nada: quantidade também fica sem dado', () => {
    const notas = rankingScores([linha('a', { closed: 3, avgHandleMin: 5 }), linha('b', { closed: 3, avgHandleMin: 10 })], RANKING_WEIGHTS_DEFAULT, null);
    expect(notas.get('a')!.parts.won).toBeNull();
    // decide pelo tempo (conversão empatada): o mais rápido ganha
    expect(notas.get('a')!.score).toBeGreaterThan(notas.get('b')!.score);
  });

  it('com faturamento, ele conta normalmente (vendas não mudou)', () => {
    const notas = rankingScores([linha('a', { revenue: 1000, won: 2, closed: 4 }), linha('b', { revenue: 500, won: 2, closed: 4 })], RANKING_WEIGHTS_DEFAULT, null);
    expect(notas.get('a')!.parts.revenue).toBe(100);
    expect(notas.get('b')!.parts.revenue).toBe(50);
    expect(notas.get('a')!.score).toBeGreaterThan(notas.get('b')!.score);
  });

  it('sem venda (peso de faturamento zerado) a ordem sai de resolvidos, taxa e tempo', () => {
    const w = effectiveRankingWeights(null, false);
    const notas = rankingScores([linha('a', { won: 10, closed: 12, avgHandleMin: 8 }), linha('b', { won: 3, closed: 12, avgHandleMin: 8 })], w, null);
    expect(notas.get('a')!.score).toBe(100);
    expect(notas.get('b')!.score).toBeLessThan(notas.get('a')!.score);
  });

  it('lista vazia e pessoa sem nenhum dado não quebram', () => {
    expect(rankingScores([], RANKING_WEIGHTS_DEFAULT, null).size).toBe(0);
    expect(rankingScores([linha('a')], RANKING_WEIGHTS_DEFAULT, 5).get('a')).toEqual({ score: 0, parts: { revenue: null, won: null, conversion: null, satisfaction: null, handleTime: null } });
  });
});
