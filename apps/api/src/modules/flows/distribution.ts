/**
 * Escolhas do bloco Distribuidor e do Randomizador, sem Nest/Prisma: é onde o fluxo decide
 * para quem vai a conversa — e onde um erro concentra tudo num atendente só.
 */

/** Motivo gravado no histórico; é ele que o rodízio procura para saber quem recebeu por último. */
export const DISTRIBUTION_REASON = 'distribuído pelo fluxo';

/** Rodízio: o próximo depois do último que recebeu, na ordem fixa da lista (volta ao início). */
export function nextInRotation(candidates: string[], lastId: string | null | undefined): string | undefined {
  if (!candidates.length) return undefined;
  const sorted = [...candidates].sort();
  const i = lastId ? sorted.indexOf(lastId) : -1;
  return sorted[(i + 1) % sorted.length];
}

/** Menos ocupado: menor número de conversas abertas; empate vai para o primeiro da lista. */
export function leastBusy(candidates: string[], openCount: Record<string, number>): string | undefined {
  return [...candidates].sort((a, b) => (openCount[a] ?? 0) - (openCount[b] ?? 0) || a.localeCompare(b))[0];
}

/** Sorteio ponderado. Peso ≤ 0 nunca sai; todos zerados = nenhum. `rand` injetável para teste. */
export function pickWeighted<T extends { weight: number }>(items: T[], rand: () => number = Math.random): T | undefined {
  const valid = items.filter((i) => Number(i.weight) > 0);
  const total = valid.reduce((s, i) => s + Number(i.weight), 0);
  if (!total) return undefined;
  let r = rand() * total;
  for (const i of valid) {
    r -= Number(i.weight);
    if (r < 0) return i;
  }
  return valid[valid.length - 1];
}
