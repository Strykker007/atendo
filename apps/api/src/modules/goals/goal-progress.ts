/**
 * Progresso de uma meta mensal (docs/metas.md). Puro: recebe o realizado, a meta e quanto do
 * mês já passou (0–1).
 *
 * - `pct` = realizado ÷ meta (pode passar de 100).
 * - `expected` = quanto já deveria ter feito no ritmo linear do mês (meta × fração do mês).
 * - `projection` = realizado ÷ fração do mês: onde termina se mantiver o ritmo.
 * - `status`: `done` (bateu), `on_track` (no ritmo), `close` (≥ 80% do esperado), `behind`.
 *   Com as duas metas, vale a pior das duas — bater o valor com uma venda só não esconde a
 *   quantidade parada.
 * - `attainment` = média dos % das metas que existem: é o que ordena o ranking.
 */
export type GoalStatus = 'done' | 'on_track' | 'close' | 'behind';

export interface GoalTargets { revenueTarget: number | null; wonTarget: number | null }

const ORDEM: GoalStatus[] = ['behind', 'close', 'on_track', 'done'];
const r1 = (n: number) => Math.round(n * 10) / 10;

function umaMeta(real: number, meta: number, elapsed: number) {
  const pct = (real / meta) * 100;
  const expected = meta * elapsed;
  const status: GoalStatus = real >= meta ? 'done' : elapsed === 0 || real >= expected ? 'on_track' : real >= expected * 0.8 ? 'close' : 'behind';
  return { pct: r1(pct), expected: Math.round(expected * 100) / 100, projection: elapsed > 0 ? Math.round((real / elapsed) * 100) / 100 : null, status };
}

export function goalProgress(actual: { revenue: number; won: number }, goal: GoalTargets | null, elapsed: number) {
  const rev = goal?.revenueTarget ? umaMeta(actual.revenue, goal.revenueTarget, elapsed) : null;
  const qtd = goal?.wonTarget ? umaMeta(actual.won, goal.wonTarget, elapsed) : null;
  const metas = [rev, qtd].filter((x): x is NonNullable<typeof x> => !!x);
  return {
    revenue: actual.revenue,
    won: actual.won,
    revenueTarget: goal?.revenueTarget ?? null,
    wonTarget: goal?.wonTarget ?? null,
    revenuePct: rev?.pct ?? null,
    wonPct: qtd?.pct ?? null,
    revenueExpected: rev?.expected ?? null,
    revenueProjection: rev?.projection ?? null,
    wonProjection: qtd?.projection != null ? Math.round(qtd.projection) : null,
    attainment: metas.length ? r1(metas.reduce((a, m) => a + m.pct, 0) / metas.length) : null,
    status: metas.length ? metas.map((m) => m.status).sort((a, b) => ORDEM.indexOf(a) - ORDEM.indexOf(b))[0] : null,
  };
}
