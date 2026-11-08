import type { Prisma, PrismaClient } from '@prisma/client';
import { AGENT_DEFAULT_MAX_REPLIES, PORTABLE_VERSION, cleanTicketFields, uniqueName, type AgentStage, type AgentToolTargets, type PortableAiAgent, type PortableTicketType, type SourceNames, type TargetRefs, type TicketPriority } from '@atendo/shared';
import { cleanStages } from '../ai/ai-agents';

/** Prisma ou a transação: a criação do cliente grava tudo numa transação só. */
type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Agentes de IA e tipos de ticket entrando e saindo de um cliente no formato portável
 * (docs/20-modelos-de-perfil.md): exportar/importar nas telas, gerar/aplicar modelo de perfil.
 */

/** Nomes por id (para exportar fluxo) e ids por nome (para importar) dos agentes e tipos do cliente. */
export async function refMaps(db: Db, tenantId: string): Promise<{ names: Pick<SourceNames, 'aiAgentNameById' | 'ticketTypeNameById'>; refs: TargetRefs }> {
  const [agents, types] = await Promise.all([
    db.aiAgent.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    db.ticketType.findMany({ where: { tenantId }, select: { id: true, name: true } }),
  ]);
  return {
    names: { aiAgentNameById: Object.fromEntries(agents.map((a) => [a.id, a.name])), ticketTypeNameById: Object.fromEntries(types.map((t) => [t.id, t.name])) },
    refs: { aiAgentIdByName: Object.fromEntries(agents.map((a) => [a.name, a.id])), ticketTypeIdByName: Object.fromEntries(types.map((t) => [t.name, t.id])) },
  };
}

/** Agentes do cliente no formato portável. Departamentos ficam (avisa); documentos ficam (avisa). */
export async function agentsToPortable(db: Db, tenantId: string, ids?: string[]): Promise<{ items: PortableAiAgent[]; warnings: string[] }> {
  const [agents, tags, reasons, docs] = await Promise.all([
    db.aiAgent.findMany({ where: { tenantId, ...(ids?.length && { id: { in: ids } }) }, orderBy: { name: 'asc' } }),
    db.tag.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    db.closeReason.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    db.aiKnowledgeDoc.groupBy({ by: ['agentId'], where: { tenantId }, _count: { _all: true } }),
  ]);
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const reasonName = new Map(reasons.map((t) => [t.id, t.name]));
  const comDocs = new Map(docs.map((d) => [d.agentId, d._count._all]));
  const warnings: string[] = [];
  const items = agents.map((a): PortableAiAgent => {
    const t = (a.targets ?? {}) as AgentToolTargets;
    if (t.departmentIds?.length) warnings.push(`${a.name}: os departamentos liberados não vão junto — escolha no destino.`);
    if (comDocs.get(a.id)) warnings.push(`${a.name}: ${comDocs.get(a.id)} documento(s) não vão junto — envie de novo no destino.`);
    return {
      atendo: 'ai-agent', version: PORTABLE_VERSION, name: a.name, persona: a.persona, tone: a.tone as PortableAiAgent['tone'], rules: a.rules, knowledge: a.knowledge,
      stages: a.stages as unknown as AgentStage[], maxReplies: a.maxReplies, isActive: a.isActive,
      targets: {
        tagNames: (t.tagIds ?? []).map((id) => tagName.get(id)).filter((x): x is string => !!x),
        closeReasonNames: (t.closeReasonIds ?? []).map((id) => reasonName.get(id)).filter((x): x is string => !!x),
        contactFields: t.contactFields ?? [],
      },
    };
  });
  return { items, warnings: [...new Set(warnings)] };
}

/**
 * Cria os agentes no cliente. Etiqueta e motivo pelo nome (ignorando maiúsculas); o que não existe
 * sai dos alvos com aviso. `onConflict`: `copy` = "(cópia)" quando o nome já existe (importação
 * pela tela); `skip` = não mexe no que já existe (modelo aplicado a quem já tem).
 */
export async function createAgentsFromPortable(db: Db, tenantId: string, items: PortableAiAgent[], onConflict: 'copy' | 'skip'): Promise<{ created: string[]; skipped: string[]; warnings: string[] }> {
  const [existing, tags, reasons] = await Promise.all([
    db.aiAgent.findMany({ where: { tenantId }, select: { name: true } }),
    db.tag.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    db.closeReason.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
  ]);
  const byName = (list: { id: string; name: string }[], n: string) => list.find((x) => x.name.toLowerCase() === n.toLowerCase())?.id;
  const taken = existing.map((e) => e.name);
  const out = { created: [] as string[], skipped: [] as string[], warnings: [] as string[] };
  for (const p of items) {
    if (onConflict === 'skip' && taken.some((n) => n.toLowerCase() === p.name.toLowerCase())) { out.skipped.push(p.name); continue; }
    const name = uniqueName(p.name, taken, 80);
    taken.push(name);
    const tagIds = (p.targets.tagNames ?? []).map((n) => byName(tags, n)).filter((x): x is string => !!x);
    const closeReasonIds = (p.targets.closeReasonNames ?? []).map((n) => byName(reasons, n)).filter((x): x is string => !!x);
    if (tagIds.length < (p.targets.tagNames?.length ?? 0) || closeReasonIds.length < (p.targets.closeReasonNames?.length ?? 0)) {
      out.warnings.push(`${name}: etiquetas ou motivos que não existem aqui saíram do que a IA pode usar.`);
    }
    let stages: AgentStage[];
    try { stages = cleanStages(p.stages); } catch (e) { throw new Error(`Agente "${p.name}": ${e instanceof Error ? e.message : 'etapas inválidas'}`); }
    await db.aiAgent.create({
      data: {
        tenantId, name, persona: p.persona, tone: p.tone, rules: p.rules, knowledge: p.knowledge, stages: stages as unknown as Prisma.InputJsonValue,
        targets: { departmentIds: [], tagIds, closeReasonIds, contactFields: p.targets.contactFields ?? [] } as unknown as Prisma.InputJsonValue,
        maxReplies: p.maxReplies || AGENT_DEFAULT_MAX_REPLIES, isActive: p.isActive,
      },
    });
    out.created.push(name);
  }
  return out;
}

export async function ticketTypesToPortable(db: Db, tenantId: string): Promise<{ items: PortableTicketType[]; warnings: string[] }> {
  const rows = await db.ticketType.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
  return {
    items: rows.map((r) => ({ atendo: 'ticket-type', version: PORTABLE_VERSION, name: r.name, color: r.color, priority: r.priority as TicketPriority, dueDays: r.dueDays, fields: cleanTicketFields(r.fields), isActive: r.isActive })),
    warnings: rows.some((r) => r.departmentId) ? ['O setor padrão dos tipos não vai junto — escolha no destino.'] : [],
  };
}

/** Cria os tipos que faltam (mesmo nome, ignorando maiúsculas, fica como está). */
export async function createTicketTypesFromPortable(db: Db, tenantId: string, items: PortableTicketType[]): Promise<{ created: string[]; skipped: string[] }> {
  const existing = await db.ticketType.findMany({ where: { tenantId }, select: { name: true } });
  const nomes = new Set(existing.map((e) => e.name.toLowerCase()));
  const novos = items.filter((t) => !nomes.has(t.name.toLowerCase()) && (nomes.add(t.name.toLowerCase()), true));
  if (novos.length) {
    await db.ticketType.createMany({
      data: novos.map((t, i) => ({ tenantId, name: t.name, color: t.color, priority: t.priority, dueDays: t.dueDays, fields: t.fields as unknown as Prisma.InputJsonValue, isActive: t.isActive, position: existing.length + i })),
      skipDuplicates: true,
    });
  }
  return { created: novos.map((t) => t.name), skipped: items.filter((t) => !novos.includes(t)).map((t) => t.name) };
}
