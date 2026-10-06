import { Injectable } from '@nestjs/common';
import { attributeVarKey, greetingAt } from '@atendo/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { InterpolateCtx } from '../../modules/flows/answer';

type ContactLike = InterpolateCtx['contact'] & { id: string };

/**
 * Monta o contexto das `{{variáveis}}` (docs/variaveis.md) — o mesmo para fluxo, boas-vindas,
 * campanha, mensagem do chat e mensagem agendada. A troca em si é o `interpolate` (puro).
 *
 * Globais: `empresa`/`company.name`, `saudacao`/`greeting` (no fuso do cliente, na hora do
 * envio) e `agent.name` quando há atendente. Campos livres da ficha entram em
 * `contact.attributes`, pela chave de `attributeVarKey`.
 */
@Injectable()
export class InterpolationService {
  constructor(private readonly prisma: PrismaService) {}

  async context(
    tenantId: string,
    contact: ContactLike,
    vars: Record<string, string> = {},
    extra?: { agentName?: string | null; now?: Date },
  ): Promise<InterpolateCtx> {
    const [tenant, settings, attrs] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } }),
      this.prisma.contactAttribute.findMany({ where: { tenantId, contactId: contact.id }, orderBy: { position: 'asc' }, select: { label: true, value: true } }),
    ]);
    const attributes: Record<string, string> = {};
    // dois rótulos com a mesma chave ("CPF" e "C P F"): vale o primeiro da ficha
    for (const a of attrs) {
      const k = attributeVarKey(a.label);
      if (k && !(k in attributes)) attributes[k] = a.value;
    }
    const company = tenant?.name ?? '';
    const greeting = greetingAt(extra?.now ?? new Date(), settings?.timezone || 'America/Sao_Paulo');
    const globals: Record<string, string> = { empresa: company, 'company.name': company, saudacao: greeting, greeting };
    if (extra?.agentName) globals['agent.name'] = extra.agentName;
    return { contact: { ...contact, attributes }, vars, globals };
  }

  /** Atalho para quem só tem os ids. */
  async forContact(tenantId: string, contactId: string, vars: Record<string, string> = {}, extra?: { agentName?: string | null }) {
    const contact = await this.prisma.contact.findFirstOrThrow({ where: { id: contactId, tenantId } });
    return this.context(tenantId, contact, vars, extra);
  }
}
