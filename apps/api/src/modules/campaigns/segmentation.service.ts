import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/** números de quem monta o público (`numberFilter`); ausente = base inteira do cliente */
type NumberScope = { in: string[] };

/** teto de um público: acima disso é base inteira, e base inteira não se dispara de uma vez */
export const AUDIENCE_MAX = 20_000;

/**
 * Público de uma transmissão (docs/envio.md#transmissão). Os critérios de filtro se combinam
 * com E; a seleção manual e a lista importada SOMAM ao resultado (OU). Sem critério nenhum, só
 * com `all` — base inteira por engano é o disparo mais caro que existe.
 */
export interface Audience {
  /** todos os contatos (só vale sem outros filtros) */
  all?: boolean;
  /** tags atuais: fixas do contato (📌) ou em alguma conversa dele */
  tagIds?: string[];
  /** tags escolhidas em encerramentos dentro do período (ex.: "Achou caro" nos últimos 30 dias) */
  closingTagIds?: string[];
  /** período dos encerramentos (`closingTagIds` e `lastOutcome`); ISO, `closingTo` exclusivo */
  closingFrom?: string;
  closingTo?: string;
  /** resultado do ÚLTIMO atendimento encerrado do contato */
  lastOutcome?: 'won' | 'lost';
  /** atendente: está com uma conversa do contato ou encerrou o último atendimento dele */
  agentId?: string;
  /** seleção manual (soma) */
  contactIds?: string[];
  /** telefones importados (soma; viram contatos ao criar a transmissão) */
  phones?: string[];
  /** grupos autorizados do número (docs/grupos.md) — não são contatos: viram `campaign_group_targets` */
  groupIds?: string[];
}

/** "(11) 99999-8888" → "5511999998888"; sem DDI assume Brasil. Inválido → null. */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length >= 12 && d.length <= 15) return d;
  return null;
}

@Injectable()
export class SegmentationService {
  constructor(private readonly prisma: PrismaService) {}

  private temFiltro(a: Audience) {
    return !!(a.tagIds?.length || a.closingTagIds?.length || a.lastOutcome || a.agentId);
  }

  /** Período dos encerramentos: o informado ou os últimos 30 dias. */
  private periodo(a: Audience) {
    const to = a.closingTo ? new Date(a.closingTo) : new Date(Date.now() + 86_400_000);
    const from = a.closingFrom ? new Date(a.closingFrom) : new Date(to.getTime() - 31 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException('Período dos encerramentos inválido');
    return { from, to };
  }

  /**
   * Ids dos contatos que os FILTROS selecionam (sem a seleção manual/importada). Sempre do
   * tenant, nunca descadastrados nem sem WhatsApp. SQL parametrizado (Prisma.sql).
   */
  private async filtrados(tenantId: string, a: Audience, numbers?: NumberScope): Promise<string[]> {
    if (!this.temFiltro(a) && !a.all) return [];
    const conds: Prisma.Sql[] = [Prisma.sql`ct."tenantId" = ${tenantId}`, Prisma.sql`ct."optOutAt" is null`, Prisma.sql`ct."waInvalidAt" is null`,
      // grupo nas conversas não é contato de transmissão: grupo entra só pelos autorizados (docs/grupos.md)
      Prisma.sql`not ct."isGroup"`];
    // restrito a empresas: só quem conversou por um número dele ou está na agenda de um deles
    if (numbers) {
      conds.push(Prisma.sql`(exists (select 1 from conversations cn where cn."contactId" = ct.id and cn."numberId" in (${Prisma.join(numbers.in)}))
        or exists (select 1 from phonebook_entries pb where pb."tenantId" = ${tenantId} and pb.phone = ct.phone and pb."numberId" in (${Prisma.join(numbers.in)})))`);
    }
    if (a.tagIds?.length) {
      conds.push(Prisma.sql`(exists (select 1 from contact_tags x where x."contactId" = ct.id and x."tagId" in (${Prisma.join(a.tagIds)}))
        or exists (select 1 from conversation_tags y join conversations cy on cy.id = y."conversationId" where cy."contactId" = ct.id and y."tagId" in (${Prisma.join(a.tagIds)})))`);
    }
    if (a.closingTagIds?.length || a.lastOutcome) {
      const { from, to } = this.periodo(a);
      if (a.closingTagIds?.length) {
        conds.push(Prisma.sql`exists (select 1 from conversation_events e join conversations ce on ce.id = e."conversationId"
          where ce."contactId" = ct.id and e."tenantId" = ${tenantId} and e.type = 'closed' and e."createdAt" >= ${from} and e."createdAt" < ${to}
            and e."tagIds" && ARRAY[${Prisma.join(a.closingTagIds)}]::text[])`);
      }
      if (a.lastOutcome) {
        // o ÚLTIMO encerramento do contato, e dentro do período
        conds.push(Prisma.sql`(select e.outcome::text from conversation_events e join conversations ce on ce.id = e."conversationId"
          where ce."contactId" = ct.id and e."tenantId" = ${tenantId} and e.type = 'closed'
          order by e."createdAt" desc limit 1) = ${a.lastOutcome}`);
        conds.push(Prisma.sql`exists (select 1 from conversation_events e join conversations ce on ce.id = e."conversationId"
          where ce."contactId" = ct.id and e."tenantId" = ${tenantId} and e.type = 'closed' and e."createdAt" >= ${from} and e."createdAt" < ${to})`);
      }
    }
    if (a.agentId) {
      conds.push(Prisma.sql`(exists (select 1 from conversations ca where ca."contactId" = ct.id and ca."assigneeId" = ${a.agentId})
        or (select e."actorId" from conversation_events e join conversations ce on ce.id = e."conversationId"
            where ce."contactId" = ct.id and e."tenantId" = ${tenantId} and e.type = 'closed' order by e."createdAt" desc limit 1) = ${a.agentId})`);
    }
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      select ct.id from contacts ct where ${Prisma.join(conds, ' and ')} limit ${AUDIENCE_MAX + 1}
    `);
    return rows.map((r) => r.id);
  }

  /** Seleção manual: só contatos do tenant que podem receber. */
  private async manuais(tenantId: string, ids?: string[], numbers?: NumberScope) {
    if (!ids?.length) return [];
    const rows = await this.prisma.contact.findMany({ where: { tenantId, id: { in: ids }, optOutAt: null, waInvalidAt: null, isGroup: false, ...(await this.escopo(tenantId, numbers)) }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** Mesma régua do SQL de `filtrados`, para as consultas do Prisma. */
  private async escopo(tenantId: string, numbers?: NumberScope): Promise<Prisma.ContactWhereInput> {
    if (!numbers) return {};
    const agenda = await this.prisma.phonebookEntry.findMany({ where: { tenantId, numberId: numbers }, select: { phone: true }, distinct: ['phone'] });
    return { OR: [{ conversations: { some: { numberId: numbers } } }, { phone: { in: agenda.map((x) => x.phone) } }] };
  }

  /** Telefones importados, normalizados e sem repetição; inválidos à parte. */
  private telefones(a: Audience) {
    const validos = new Set<string>();
    let invalidos = 0;
    for (const p of a.phones ?? []) {
      const n = normalizePhone(p);
      if (n) validos.add(n);
      else if (p.trim()) invalidos++;
    }
    return { validos: [...validos], invalidos };
  }

  /** Quantos receberiam — mostrado antes de criar. Não cria nada (telefone novo conta como novo). */
  async preview(tenantId: string, a: Audience, numbers?: NumberScope) {
    const [filtrados, manuais] = await Promise.all([this.filtrados(tenantId, a, numbers), this.manuais(tenantId, a.contactIds, numbers)]);
    const { validos, invalidos } = this.telefones(a);
    const existentes = validos.length ? await this.prisma.contact.findMany({ where: { tenantId, phone: { in: validos } }, select: { id: true, optOutAt: true, waInvalidAt: true } }) : [];
    const ids = new Set([...filtrados, ...manuais, ...existentes.filter((c) => !c.optOutAt && !c.waInvalidAt).map((c) => c.id)]);
    const novos = validos.length - existentes.length;
    const bloqueados = existentes.filter((c) => c.optOutAt || c.waInvalidAt).length;
    // descadastrados que os filtros pegariam: mostrado para o cliente entender por que o número é menor
    const optOut = a.tagIds?.length || a.all
      ? await this.prisma.contact.count({ where: { tenantId, optOutAt: { not: null }, AND: [await this.escopo(tenantId, numbers)], ...(a.tagIds?.length && { OR: [{ tags: { some: { tagId: { in: a.tagIds } } } }, { conversations: { some: { tags: { some: { tagId: { in: a.tagIds } } } } } }] }) } })
      : 0;
    return { total: ids.size + novos, novos, invalidos, optOut: optOut + bloqueados, excedeu: ids.size + novos > AUDIENCE_MAX, max: AUDIENCE_MAX };
  }

  /**
   * A lista final, materializada na criação da transmissão: filtros + manuais + importados (que
   * viram contatos agora). Quem entrar no filtro depois não recebe um disparo que já começou.
   */
  async resolve(tenantId: string, a: Audience, numbers?: NumberScope): Promise<string[]> {
    const [filtrados, manuais] = await Promise.all([this.filtrados(tenantId, a, numbers), this.manuais(tenantId, a.contactIds, numbers)]);
    const { validos } = this.telefones(a);
    let importados: string[] = [];
    if (validos.length) {
      await this.prisma.contact.createMany({ data: validos.map((phone) => ({ tenantId, phone })), skipDuplicates: true });
      const rows = await this.prisma.contact.findMany({ where: { tenantId, phone: { in: validos }, optOutAt: null, waInvalidAt: null }, select: { id: true } });
      importados = rows.map((r) => r.id);
    }
    const ids = [...new Set([...filtrados, ...manuais, ...importados])];
    if (ids.length > AUDIENCE_MAX) throw new BadRequestException(`Público grande demais (${ids.length.toLocaleString('pt-BR')}). O máximo por transmissão é ${AUDIENCE_MAX.toLocaleString('pt-BR')} — refine os filtros.`);
    return ids;
  }

  /** Para validar o DTO: há algum critério? */
  isEmpty(a: Audience) {
    return !this.temFiltro(a) && !a.all && !a.contactIds?.length && !a.phones?.length && !a.groupIds?.length;
  }
}
