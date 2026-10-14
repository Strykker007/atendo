import type { Prisma, PrismaClient } from '@prisma/client';

/** teto de opostas por tag: é a trava contra uma marcação apagar tags em massa */
export const MAX_CONFLICTS_PER_TAG = 20;

type Db = PrismaClient | Prisma.TransactionClient;

/** par na forma guardada: uma linha por par, menor id primeiro */
export const conflictPair = (a: string, b: string) => (a < b ? { tagId: a, otherId: b } : { tagId: b, otherId: a });

/** opostas diretas de cada tag pedida (só as do tenant: as duas pontas são validadas na gravação) */
export async function conflictMap(db: Db, tagIds: string[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (!tagIds.length) return map;
  const rows = await db.tagConflict.findMany({ where: { OR: [{ tagId: { in: tagIds } }, { otherId: { in: tagIds } }] }, select: { tagId: true, otherId: true } });
  const add = (a: string, b: string) => map.set(a, (map.get(a) ?? new Set()).add(b));
  for (const r of rows) { add(r.tagId, r.otherId); add(r.otherId, r.tagId); }
  return map;
}

/**
 * Troca inteligente: para cada tag NOVA (não estava em `current`), tira só as opostas diretas
 * dela — nunca em cadeia, e as que já estavam juntas antes continuam (quem configurou o conflito
 * depois não perde nada sem ter mexido). Duas opostas novas na mesma lista: vale a última.
 */
export function resolveConflicts(current: string[], next: string[], conflicts: Map<string, Set<string>>): string[] {
  const before = new Set(current);
  const keep = new Set(next);
  // de trás para frente: a última nova tira a anterior, não o contrário
  for (const id of [...next].reverse()) {
    if (before.has(id) || !keep.has(id)) continue;
    for (const c of conflicts.get(id) ?? []) if (c !== id) keep.delete(c);
  }
  return next.filter((id) => keep.has(id));
}
