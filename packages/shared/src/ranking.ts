/**
 * Pontuação do ranking de consultores (docs/metas.md › Ranking). Uma métrica só
 * (vendas) premiava quem pega mais fila, não quem atende melhor: a posição sai de uma nota de 0 a
 * 100 que combina faturamento, vendas, conversão, satisfação e tempo de atendimento, com pesos
 * que a empresa ajusta. Pura, para a API ordenar e a tela mostrar a composição.
 */

export const RANKING_METRICS = ['revenue', 'won', 'conversion', 'satisfaction', 'handleTime'] as const;
export type RankingMetric = (typeof RANKING_METRICS)[number];
export type RankingWeights = Record<RankingMetric, number>;

export const RANKING_WEIGHTS_DEFAULT: RankingWeights = { revenue: 35, won: 20, conversion: 20, satisfaction: 15, handleTime: 10 };
export const RANKING_METRIC_LABEL: Record<RankingMetric, string> = {
  revenue: 'Faturamento',
  won: 'Vendas',
  conversion: 'Conversão',
  satisfaction: 'Satisfação',
  handleTime: 'Tempo de atendimento',
};
export const RANKING_METRIC_HINT: Record<RankingMetric, string> = {
  revenue: 'Faturado em relação ao maior do período',
  won: 'Quantidade de vendas em relação à maior',
  conversion: 'Vendas ÷ concluídos, suavizada para quem atendeu pouco (1 venda em 1 atendimento não vale 100%)',
  satisfaction: 'Média da pesquisa de satisfação na escala usada',
  handleTime: 'Quanto mais rápido, mais pontos (o mais rápido do período = 100)',
};

/** Pesos válidos: inteiros de 0 a 100; todos zero (ou inválidos) = padrão. */
export function normalizeRankingWeights(raw: unknown): RankingWeights {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<RankingMetric, unknown>>;
  const w = Object.fromEntries(RANKING_METRICS.map((k) => {
    const v = Number(o[k]);
    return [k, Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : RANKING_WEIGHTS_DEFAULT[k]];
  })) as RankingWeights;
  return RANKING_METRICS.some((k) => w[k] > 0) ? w : { ...RANKING_WEIGHTS_DEFAULT };
}

export interface RankingInput {
  userId: string;
  revenue: number;
  won: number;
  closed: number;
  avgHandleMin: number | null;
  /** média da pergunta principal; null = sem respostas no período */
  satisfactionAvg: number | null;
}
/** Cada parte de 0 a 100; `null` = sem dado (o peso dela é redistribuído entre as outras). */
export type RankingParts = Record<RankingMetric, number | null>;

/**
 * Nota de cada consultor. Cada métrica vira 0–100 em relação ao melhor do período (satisfação,
 * em relação ao teto da escala); a nota é a média ponderada das partes que a pessoa tem — quem não
 * recebeu pesquisa não leva zero em satisfação, o peso vai para o resto.
 */
export function rankingScores(rows: RankingInput[], weights: RankingWeights, satisfactionMax: number | null): Map<string, { score: number; parts: RankingParts }> {
  // conversão suavizada (Laplace): 1/1 vira 67%, 30/40 fica em 74% — volume conta
  const conv = (r: RankingInput) => (r.won + 1) / (r.closed + 2);
  const maxRevenue = Math.max(0, ...rows.map((r) => r.revenue));
  const maxWon = Math.max(0, ...rows.map((r) => r.won));
  const maxConv = Math.max(0, ...rows.filter((r) => r.closed > 0).map(conv));
  const tmas = rows.map((r) => r.avgHandleMin).filter((v): v is number => v != null && v > 0);
  const minTma = tmas.length ? Math.max(1, Math.min(...tmas)) : null;
  const pct = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;

  const out = new Map<string, { score: number; parts: RankingParts }>();
  for (const r of rows) {
    const parts: RankingParts = {
      revenue: maxRevenue > 0 ? pct((r.revenue / maxRevenue) * 100) : 0,
      won: maxWon > 0 ? pct((r.won / maxWon) * 100) : 0,
      conversion: r.closed > 0 && maxConv > 0 ? pct((conv(r) / maxConv) * 100) : null,
      satisfaction: r.satisfactionAvg != null && satisfactionMax ? pct((r.satisfactionAvg / satisfactionMax) * 100) : null,
      handleTime: r.avgHandleMin != null && minTma ? pct((minTma / Math.max(1, r.avgHandleMin)) * 100) : null,
    };
    let soma = 0;
    let pesos = 0;
    for (const k of RANKING_METRICS) {
      const p = parts[k];
      if (p == null || !weights[k]) continue;
      soma += p * weights[k];
      pesos += weights[k];
    }
    out.set(r.userId, { score: pesos ? Math.round((soma / pesos) * 10) / 10 : 0, parts });
  }
  return out;
}
