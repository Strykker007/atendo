import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { countLimit, type PlanLimits } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { PromotionsService } from '../billing/promotions.service';
import { DiscountLedgerService } from '../billing/discount-ledger.service';
import { freePeriod } from '../billing/plan-rules';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { provisionedTags, templateTagConflictPairs, type TemplateContent } from './tenant-template';
import { conflictPair } from '../tags/conflicts';

export interface NewTenantInput {
  name: string;
  slug: string;
  planId: string;
  adminEmail: string;
  adminName: string;
  adminPassword?: string;
  /** ausente = modelo padrão; null = nenhum */
  templateId?: string | null;
}

/**
 * Criação de cliente — a mesma para o dono (Clientes) e para o VogoPartner (portal do parceiro,
 * docs/37-vogopartners.md), que só muda o vínculo com o parceiro e quem assina o convite.
 */
@Injectable()
export class TenantCreationService {
  private readonly log = new Logger('Tenants');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly provisioning: TenantProvisioningService,
    private readonly promotions: PromotionsService,
    private readonly ledger: DiscountLedgerService,
  ) {}

  async create(dto: NewTenantInput, opts: { partnerId?: string; inviterName?: string } = {}) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: dto.planId } });
    const template = dto.templateId
      ? await this.prisma.tenantTemplate.findUnique({ where: { id: dto.templateId } })
      : dto.templateId === undefined ? await this.prisma.tenantTemplate.findFirst({ where: { isDefault: true } }) : null;
    if (dto.templateId && !template) throw new BadRequestException('Modelo de perfil não encontrado.');
    const content = template ? (template.content as unknown as TemplateContent) : null;
    // tudo ou nada também no limite do plano: cliente nascendo acima do limite já começa travado
    const maxReplies = countLimit(plan.limits as unknown as PlanLimits, 'maxQuickReplies');
    if (content && maxReplies !== null && content.quickReplies.length > maxReplies) {
      throw new BadRequestException(`O modelo "${template!.name}" tem ${content.quickReplies.length} respostas rápidas e o plano ${plan.name} permite ${maxReplies}.`);
    }
    if (await this.prisma.user.count({ where: { email: dto.adminEmail } })) throw new BadRequestException('Este e-mail já está em uso.');
    // gratuito nasce ativo, sem cartão, e com o fim da degustação (se houver) como fim do período;
    // pago segue como antes: `trialing` até o primeiro checkout
    const { start, end } = freePeriod(plan.isFree ? plan.durationDays : null);
    // promoção de entrada aberta para o plano: o cliente já nasce com o desconto (docs/05#promoções)
    const promo = await this.promotions.quote(plan, null);
    // hash fora da transação: é lento de propósito, e a transação segura locks enquanto espera
    const passwordHash = await this.auth.hashPassword(dto.adminPassword ?? randomBytes(24).toString('base64url'));
    const { tenant, admin } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          templateId: template?.id ?? null,
          // cadastrado por um VogoPartner: fica com ele até o cancelamento (docs/37-vogopartners.md)
          ...(opts.partnerId && { partnerId: opts.partnerId, partnerAttributedAt: new Date() }),
          subscription: { create: { planId: dto.planId, status: plan.isFree ? 'active' : 'trialing', currentPeriodStart: start, currentPeriodEnd: end, ...(plan.isFree && { priceMonth: 0 }), ...(promo && { priceMonth: promo.priceMonth }) } },
          ...(promo && { planOverride: { create: this.promotions.overrideData(dto.planId, promo) } }),
        },
        include: { subscription: true },
      });
      // configurações de atendimento do modelo (encerramento sem venda, assinatura, nomes dos resultados)
      await tx.tenantSettings.create({ data: { tenantId: tenant.id, ...content?.settings } });
      // livro de descontos: nasceu com promoção (docs/05#livro-de-descontos)
      if (promo) await this.ledger.open({ tenantId: tenant.id, plan, priceMonth: promo.priceMonth, kind: 'promotion', source: 'tenant_create', promotion: promo.promotion, endsAt: promo.expiresAt }, tx);
      // tags do modelo, na ordem dele (é a das colunas do Kanban). As marcadas para o encerramento
      // (Comprou / Não comprou) viram MOTIVOS de encerramento — a lista própria, separada das tags
      // (docs/06-modelo-de-dados.md#encerramento); continuam tag só se também forem etapa do Kanban
      const modelo = provisionedTags(content);
      const deEncerramento = modelo.filter((t) => t.showOnWon || t.showOnLost);
      await tx.tag.createMany({ data: modelo.filter((t) => t.isKanban || !(t.showOnWon || t.showOnLost)).map((t, position) => ({ tenantId: tenant.id, name: t.name, position, isKanban: !!t.isKanban, ...(t.color && { color: t.color }) })), skipDuplicates: true });
      // "conflita com" do modelo: só entre as que ficaram tag (as que viraram motivo não são tag aqui)
      const pares = templateTagConflictPairs(modelo);
      if (pares.length) {
        const idPorNome = new Map((await tx.tag.findMany({ where: { tenantId: tenant.id }, select: { id: true, name: true } })).map((t) => [t.name.toLowerCase(), t.id]));
        const data = pares.map(([a, b]) => [idPorNome.get(a), idPorNome.get(b)] as const).filter((p): p is readonly [string, string] => !!p[0] && !!p[1]).map(([a, b]) => conflictPair(a, b));
        if (data.length) await tx.tagConflict.createMany({ data, skipDuplicates: true });
      }
      await tx.closeReason.createMany({
        data: deEncerramento.map((t, position) => ({ tenantId: tenant.id, name: t.name, position, outcome: t.showOnWon && t.showOnLost ? 'both' : t.showOnWon ? 'won' : 'lost', ...(t.color && { color: t.color }) })),
        skipDuplicates: true,
      });
      await this.provisioning.provision(tx, tenant.id, content);
      const adminProfile = await tx.accessProfile.findFirstOrThrow({ where: { tenantId: tenant.id, isSystem: true, systemRole: 'tenant_admin' }, select: { id: true } });
      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id, email: dto.adminEmail, name: dto.adminName, role: 'tenant_admin', passwordHash,
          profileId: template ? adminProfile.id : null,
          ...(dto.adminPassword ? { passwordSetAt: new Date() } : { invitedAt: new Date() }),
        },
      });
      return { tenant, admin };
    }, { timeout: 30_000 });
    if (!dto.adminPassword) {
      // o e-mail é melhor esforço: sem provedor configurado, o dono usa o link copiável da equipe
      await this.auth.sendInvite(admin.id, opts.inviterName ?? 'Equipe Atendo', tenant.name).catch((err) => this.log.warn(`Convite por e-mail não enviado para ${dto.adminEmail}: ${err instanceof Error ? err.message : err}`));
    }
    return tenant;
  }
}
