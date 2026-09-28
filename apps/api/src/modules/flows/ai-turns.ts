/** Limite padrão de respostas da IA numa conversa, quando o bloco não define outro. */
export const DEFAULT_MAX_TURNS = 10;

/**
 * O que fazer depois de a IA responder:
 * - `wait`  — continua conversando, esperando a próxima mensagem do contato;
 * - `done`  — sai pela saída "Respondeu" (tiro único, ou limite de turnos atingido).
 *
 * O limite é o **freio de custo**: sem ele, uma conversa sozinha consome interações de IA
 * indefinidamente. Ao atingir, o fluxo segue pela saída normal — que o cliente deve ligar
 * a um humano.
 */
export function afterAiAnswer(turns: number, opts: { keepTalking?: boolean; maxTurns?: number }): 'wait' | 'done' {
  if (!opts.keepTalking) return 'done';
  return turns >= Math.max(1, opts.maxTurns ?? DEFAULT_MAX_TURNS) ? 'done' : 'wait';
}
