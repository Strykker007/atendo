/**
 * Redistribuição automática de conversas órfãs (docs/redistribuicao-automatica.md). Regras puras,
 * sem Nest/Prisma — o tempo de espera e quem pode receber são o coração da funcionalidade.
 */

/** Motivo gravado no evento `transferred`: é por ele que se conta quantas vezes a mesma espera já rodou. */
export const AUTO_REASSIGN_REASON = 'redistribuído automaticamente';

// tempo de espera (base → teto pela carga): no shared, a tela mostra a mesma conta
export { reassignAfterMinutes, AUTO_REASSIGN_FULL_LOAD } from '@atendo/shared';

/**
 * Desde quando conta o tempo DESTE dono: o mais recente entre o início da espera do contato e a
 * última vez que a conversa mudou de mãos (assumiu, transferiu, devolveu). Quem acabou de receber
 * ganha o tempo inteiro, mesmo que o contato já esperasse antes.
 */
export function waitingClockStart(awaitingSince: Date, lastHandoff: Date | null | undefined): Date {
  return lastHandoff && lastHandoff > awaitingSince ? lastHandoff : awaitingSince;
}

/**
 * Para quem vai: online, com acesso à conversa, fora quem está com ela e quem já a recebeu nesta
 * mesma espera (sem pingue-pongue); entre esses, o com menos conversas abertas.
 */
export function pickReassignTarget(input: {
  eligible: string[];
  online: ReadonlySet<string>;
  exclude: ReadonlySet<string>;
  openCount: Record<string, number>;
}): string | undefined {
  const pool = input.eligible.filter((id) => input.online.has(id) && !input.exclude.has(id));
  return pool.sort((a, b) => (input.openCount[a] ?? 0) - (input.openCount[b] ?? 0) || a.localeCompare(b))[0];
}
