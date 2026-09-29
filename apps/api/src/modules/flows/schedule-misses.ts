/** Quantas respostas não entendidas antes de chamar um humano no bloco de agendamento. */
export const MAX_SCHEDULE_MISSES = 3;

/**
 * O que fazer com uma resposta que o agendamento não entendeu.
 *
 * Repetir o menu indefinidamente prende o contato ouvindo "não entendi" e ele nunca chega
 * a uma pessoa — foi exatamente o que aconteceu num teste real.
 */
export function onScheduleMiss(misses: number, max = MAX_SCHEDULE_MISSES): { action: 'repeat' | 'handoff'; misses: number } {
  const n = misses + 1;
  return n >= Math.max(1, max) ? { action: 'handoff', misses: n } : { action: 'repeat', misses: n };
}
