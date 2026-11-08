/**
 * Fila de atendimento (docs/fila-de-atendimento.md) — a parte PURA e testada: para quem vai o
 * próximo contato da fila.
 */

/** Motivo gravado no histórico (evento `transferred`) de quem recebeu pela fila. */
export const QUEUE_REASON = 'distribuído pela fila';

/**
 * Entre quem pode atender a conversa: só quem está abaixo do limite; vai para quem tem MENOS
 * atendimentos abertos (por igual) e, no empate, sorteio (aleatório — ninguém fica sempre na frente
 * por ordem alfabética). Ninguém abaixo do limite = fica na fila.
 */
export function pickQueueAgent(eligible: string[], openCount: Record<string, number>, max: number, rand: () => number = Math.random): string | undefined {
  const livres = eligible.filter((id) => (openCount[id] ?? 0) < max);
  if (!livres.length) return undefined;
  const menor = Math.min(...livres.map((id) => openCount[id] ?? 0));
  const empatados = livres.filter((id) => (openCount[id] ?? 0) === menor);
  return empatados[Math.min(empatados.length - 1, Math.floor(rand() * empatados.length))];
}

/** Pausa com prazo vencido (o job fecha). `until` null = até a pessoa voltar. */
export const pauseExpired = (until: Date | null, now = new Date()) => !!until && until.getTime() <= now.getTime();
