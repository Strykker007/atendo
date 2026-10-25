/**
 * E-mail de quem é a linha de usuário: o próprio ou, num vínculo (outra empresa da mesma pessoa,
 * docs/multiempresa.md), o do login principal. Use com `LOGIN_EMAIL_SELECT` no select/include.
 */
export const LOGIN_EMAIL_SELECT = { email: true, primaryUser: { select: { email: true } } } as const;

export function loginEmail(u: { email: string | null; primaryUser?: { email: string | null } | null } | null | undefined): string | null {
  return u?.email ?? u?.primaryUser?.email ?? null;
}
