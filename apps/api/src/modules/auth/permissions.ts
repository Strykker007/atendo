import { DEFAULT_PERMISSIONS, isPermission, type Permission } from '@atendo/shared';

/**
 * Resolve o que um usuário pode fazer. Puro de propósito: é a regra mais sensível do
 * sistema e precisa ser testável sem banco.
 *
 * Duas fontes, nesta ordem:
 *   1. o **perfil de acesso** do usuário, quando ele tem um;
 *   2. o papel (`role`), para quem ainda não tem perfil — é o que mantém todo mundo que
 *      existia antes dos perfis funcionando igual.
 */

export interface Principal {
  role: 'super_admin' | 'tenant_admin' | 'manager' | 'agent';
  /** permissões do perfil de acesso; `null`/ausente = usuário sem perfil */
  profilePermissions?: string[] | null;
}

export function permissionsOf(user: Principal): Permission[] {
  // o dono do sistema não é membro de cliente nenhum: ele não "tem" permissões de cliente,
  // ele passa por fora (ver `can`). Devolver tudo aqui faria a UI do cliente aparecer para
  // ele como se fosse dele.
  if (user.role === 'super_admin') return [];
  if (user.profilePermissions) return sanitize(user.profilePermissions);
  return [...DEFAULT_PERMISSIONS[user.role]];
}

/**
 * O dono do sistema passa por qualquer checagem — é ele quem dá suporte entrando como o
 * cliente. Fora isso, vale a lista.
 */
export function can(user: Principal, required: Permission): boolean {
  if (user.role === 'super_admin') return true;
  return permissionsOf(user).includes(required);
}

/**
 * Filtra o que veio de fora (corpo da requisição) contra a lista fechada. Permissão
 * desconhecida é descartada em silêncio: guardar texto livre no banco significaria que
 * ninguém mais sabe o que aquele perfil autoriza.
 */
export function sanitize(input: unknown): Permission[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter(isPermission))];
}

/**
 * Um perfil não pode dar o que quem edita não tem — senão qualquer um com `profiles.manage`
 * cria um perfil com `billing.manage` e se promove a dono da conta.
 */
export function grantable(editor: Principal, wanted: unknown): Permission[] {
  const allowed = sanitize(wanted);
  if (editor.role === 'super_admin') return allowed;
  const mine = permissionsOf(editor);
  return allowed.filter((p) => mine.includes(p));
}
