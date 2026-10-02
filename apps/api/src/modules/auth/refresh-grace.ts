/**
 * Um refresh token recém-rotacionado ainda vale por alguns segundos.
 *
 * A rotação é o que protege contra reuso de token roubado, mas ela briga com o mundo real:
 * duas abas abertas (ou uma aba e o celular) renovam quase ao mesmo tempo, a segunda
 * apresenta o token que acabou de ser revogado e cai fora. Para o usuário isso é "o sistema
 * me deslogou sozinho".
 *
 * A janela é curta de propósito: protege a corrida de milissegundos, não um token vazado.
 */
export const REFRESH_GRACE_MS = 30_000;

export function refreshAcceptable(
  row: { revokedAt: Date | null; expiresAt: Date },
  now = new Date(),
  graceMs = REFRESH_GRACE_MS,
): boolean {
  if (row.expiresAt <= now) return false;
  if (!row.revokedAt) return true;
  return now.getTime() - row.revokedAt.getTime() <= graceMs;
}
