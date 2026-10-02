/**
 * Quando vale a pena buscar a foto de perfil de um contato.
 *
 * Buscar a cada mensagem recebida faria uma chamada extra ao provider em todo "oi" — e a
 * Evolution ainda baixa a imagem da CDN do WhatsApp por baixo. Então: busca na primeira vez
 * e depois só de vez em quando, porque as pessoas trocam de foto.
 */

export const AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Depois de uma tentativa sem foto, não insiste no mesmo dia. */
export const AVATAR_RETRY_MS = 24 * 60 * 60 * 1000;

export function shouldRefreshAvatar(
  contact: { avatarUrl: string | null; avatarCheckedAt: Date | null },
  now = new Date(),
  ttlMs = AVATAR_TTL_MS,
  retryMs = AVATAR_RETRY_MS,
): boolean {
  if (!contact.avatarCheckedAt) return true;
  const idade = now.getTime() - contact.avatarCheckedAt.getTime();
  // sem foto: pode ser que o contato não tenha, ou que esconda de desconhecidos — insistir de
  // hora em hora não traria nada
  return contact.avatarUrl ? idade > ttlMs : idade > retryMs;
}
