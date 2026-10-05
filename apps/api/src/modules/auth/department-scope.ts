import type { Prisma } from '@prisma/client';

/**
 * Quais departamentos o usuário enxerga. Mesmo espírito de `number-scope.ts`: é escopo de
 * **dados**, e **lista vazia = sem restrição** (quem nunca foi colocado num departamento
 * continua vendo a fila inteira — ligar a funcionalidade não tranca ninguém para fora).
 *
 * Quem tem `conversations.view_all` (gerente, atendente líder) também vê todos: é quem
 * coordena a equipe, e precisa enxergar as filas que coordena.
 *
 * Restrito, o usuário vê as conversas dos departamentos dele **e as sem departamento** — a
 * conversa que ainda não passou por nenhuma triagem não pode ficar invisível para todo mundo.
 */
export interface DeptScoped {
  role: string;
  permissions?: readonly string[];
  /** ids dos departamentos do usuário; vazio = sem restrição */
  departmentIds?: readonly string[];
}

export function departmentRestricted(user: DeptScoped): boolean {
  return user.role !== 'super_admin' && !user.permissions?.includes('conversations.view_all') && !!user.departmentIds?.length;
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
