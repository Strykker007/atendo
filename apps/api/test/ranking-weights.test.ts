import { describe, expect, it } from 'vitest';
import { effectiveRankingWeights, rankingScores, RANKING_WEIGHTS_DEFAULT } from '@atendo/shared';

describe('effectiveRankingWeights', () => {
  it('com venda: pesos da empresa como estão', () => {
    expect(effectiveRankingWeights(null, true)).toEqual(RANKING_WEIGHTS_DEFAULT);
  });

  it('sem venda: faturamento sai da conta, o resto fica', () => {
    expect(effectiveRankingWeights({ revenue: 50, won: 10, conversion: 0, satisfaction: 0, handleTime: 0 }, false)).toEqual({ revenue: 0, won: 10, conversion: 0, satisfaction: 0, handleTime: 0 });
  });

  it('sem venda e só faturamento com peso: volta ao padrão sem faturamento', () => {
    expect(effectiveRankingWeights({ revenue: 50, won: 0, conversion: 0, satisfaction: 0, handleTime: 0 }, false)).toEqual({ ...RANKING_WEIGHTS_DEFAULT, revenue: 0 });
  });
});

describe('rankingScores', () => {
  it('ninguém faturou: faturamento fica sem dado, não zera a nota de todos', () => {
    const notas = rankingScores(
      [
        { userId: 'a', revenue: 0, won: 4, closed: 5, avgHandleMin: 10, satisfactionAvg: null },
        { userId: 'b', revenue: 0, won: 2, closed: 5, avgHandleMin: 20, satisfactionAvg: null },
      ],
      RANKING_WEIGHTS_DEFAULT,
      null,
    );
    expect(notas.get('a')!.parts.revenue).toBeNull();
    // melhor em tudo que tem dado = 100
    expect(notas.get('a')!.score).toBe(100);
    expect(notas.get('b')!.score).toBeLessThan(100);
  });
});
