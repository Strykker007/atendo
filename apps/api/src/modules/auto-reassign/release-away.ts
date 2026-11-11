/**
 * Devolver para a fila os atendimentos de quem saiu (docs/redistribuicao-automatica.md#saiu-do-plantão).
 * Regra pura: a rodada de cada minuto pergunta, para cada pessoa com atendimento aberto, o que fazer.
 */

export const RELEASE_AWAY_REASON = 'saiu do plantão';

/**
 * - `clear`: está presente (painel aberto e no turno, ou em pausa) → zera o relógio;
 * - `mark`: acabou de sumir → começa a contar agora;
 * - `wait`: sumiu, mas ainda dentro do tempo;
 * - `release`: fora há `minutes` ou mais → devolve.
 */
export type AwayDecision = 'clear' | 'mark' | 'wait' | 'release';

export function awayDecision(present: boolean, awaySince: number | null, now: number, minutes: number): AwayDecision {
  if (present) return 'clear';
  if (awaySince == null || !Number.isFinite(awaySince)) return 'mark';
  return now - awaySince >= minutes * 60_000 ? 'release' : 'wait';
}

/** Quem pode ter os atendimentos devolvidos: o admin da conta segura os dele (é quem responde pela conta). */
export const releasableRole = (role: string) => role === 'agent' || role === 'manager';

export const releaseAwayNote = (name: string, minutes: number) =>
  `↩️ Devolvida para a fila automaticamente: ${name} saiu do plantão (fora do painel há ${minutes} min).`;
