/**
 * Robô pausado só numa conversa (docs/fluxos.md → Pausar o robô).
 *
 * `botPausedUntil` vencido conta como NÃO pausado mesmo antes do job de fim da pausa rodar:
 * fila atrasada ou job perdido não pode deixar o robô mudo além do combinado.
 */
export function botPaused(c: { botPausedAt: Date | null; botPausedUntil: Date | null }, now = new Date()) {
  return !!c.botPausedAt && (!c.botPausedUntil || c.botPausedUntil > now);
}

/** Durações oferecidas na tela, em minutos. Ausente = até retomar manualmente. */
export const BOT_PAUSE_MINUTES = [30, 60, 240] as const;

/** Dados que limpam a pausa (encerrar o atendimento também usa). */
export const BOT_PAUSE_CLEAR = { botPausedAt: null, botPausedById: null, botPausedUntil: null } as const;
