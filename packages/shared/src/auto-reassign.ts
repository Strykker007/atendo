/**
 * Redistribuição automática de conversas órfãs (docs/redistribuicao-automatica.md): o tempo de
 * espera. Fica no shared porque a tela de configuração mostra a mesma conta que o servidor faz.
 */

/** Carga (contatos esperando por atendente online) a partir da qual vale o teto. */
export const AUTO_REASSIGN_FULL_LOAD = 4;

/**
 * Minutos sem resposta antes de redistribuir. Até 1 contato esperando por atendente online = base;
 * cresce em linha reta até o teto com `AUTO_REASSIGN_FULL_LOAD` ou mais. Na alta demanda todo mundo
 * está ocupado: tirar a conversa de alguém cedo demais só troca de fila, não atende mais rápido.
 * `null` = ninguém online (não há para quem mandar).
 */
export function reassignAfterMinutes(baseMin: number, maxMin: number, waiting: number, online: number): number | null {
  if (online <= 0) return null;
  const base = Math.max(1, baseMin);
  const max = Math.max(base, maxMin);
  const load = waiting / online;
  if (load <= 1) return base;
  const t = Math.min(1, (load - 1) / (AUTO_REASSIGN_FULL_LOAD - 1));
  return Math.round(base + (max - base) * t);
}
