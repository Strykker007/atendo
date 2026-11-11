import type { Prisma } from '@prisma/client';

/**
 * Quais departamentos o usuário enxerga. Mesmo espírito de `number-scope.ts`: é escopo de
 * **dados**, e **lista vazia = sem restrição** (quem nunca foi colocado num departamento
 * continua vendo a fila inteira — ligar a funcionalidade não tranca ninguém para fora).
 *
 * Hierarquia (docs/departamentos.md#hierarquia): `departmentIds` já chega como **alcance**
 * (`PermissionsService.scope`). Quem tem `conversations.view_all` (gestor) recebe o departamento
 * dele e todos os que ficam abaixo; os demais, só os de que participam. Ver toda a equipe NÃO
 * libera os outros departamentos: o gestor da Portaria não vê a Administração. Só o admin da
 * conta (e quem não está em departamento nenhum) vê todos.
 *
 * Restrito, o usuário vê as conversas dos departamentos dele **e as sem departamento** — a
 * conversa que ainda não passou por nenhuma triagem não pode ficar invisível para todo mundo.
 */
export interface DeptScoped {
  role: string;
  permissions?: readonly string[];
  /** alcance de departamentos do usuário (os dele + os abaixo, se gestor); vazio = sem restrição */
  departmentIds?: readonly string[];
}

export function departmentRestricted(user: DeptScoped): boolean {
  return user.role !== 'super_admin' && user.role !== 'tenant_admin' && !!user.departmentIds?.length;
}

export function canSeeDepartment(user: DeptScoped, departmentId: string | null | undefined): boolean {
  if (!departmentId || !departmentRestricted(user)) return true;
  return user.departmentIds!.includes(departmentId);
}

/**
 * Filtro do Prisma: escopo do usuário ∩ filtro pedido na tela.
 * `requested`: id do departamento, `'none'` = só sem departamento, vazio = todos que ele vê.
 * Pedir um departamento que não enxerga devolve lista vazia — nunca "sem filtro".
 */
export function departmentWhere(user: DeptScoped, requested?: string | null): Prisma.ConversationWhereInput | undefined {
  const restricted = departmentRestricted(user);
  if (requested === 'none') return { departmentId: null };
  if (requested) return canSeeDepartment(user, requested) ? { departmentId: requested } : { departmentId: '-' };
  if (!restricted) return undefined;
  return { OR: [{ departmentId: null }, { departmentId: { in: [...user.departmentIds!] } }] };
}
