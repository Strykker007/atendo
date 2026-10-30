import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { templateHeaderMedia, type TemplateChoice } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SchedulesService } from '../tenants/schedules.service';
import { SendPacer } from '../whatsapp/send-pacer';
import { NumbersService } from '../whatsapp/numbers.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { AppLogger } from '../../common/observability/app-logger';
import { QUEUE_CAMPAIGN, type CampaignJob } from './queues';
import { SegmentationService, type Audience } from './segmentation.service';
import { QR_WINDOW_MS } from './dispatch';
import { UsageService } from '../billing/usage.service';
import { PricingService } from '../billing/pricing.service';

export type { Audience } from './segmentation.service';

/** escolha de template salva na campanha (Meta) — a mesma do envio manual */
export type CampaignTemplate = TemplateChoice;

export interface CreateCampaign {
  name: string;
  numberId: string;
  text?: string;
  mediaKey?: string;
  mediaType?: string;
  mediaName?: string;
  template?: CampaignTemplate;
  startAt?: string;
  businessHoursOnly?: boolean;
  audience: Audience;
}

/**
 * Previsão antes de disparar pela API oficial (docs/gasto-meta.md#transmissão): o que impede o
 * início (`blockers`), o que merece atenção (`warnings`) e quanto a Meta vai cobrar.
 */
export interface CampaignEstimate {
  provider: 'meta' | 'evolution';
  recipients: number;
  /** categoria do template (define o preço na Meta) */
  category: string | null;
  /** preço por mensagem na tabela, em BRL */
  unitPrice: number;
  /** recipients × unitPrice — estimativa; o valor real vem da Meta depois */
  total: number;
  /** templates do plano do Atendo (cota própria, à parte do que a Meta cobra) */
  plan: { included: number | null; remaining: number | null; hardLimit: boolean; overageCount: number; overagePrice: number | null } | null;
  /** gasto do mês com a Meta e orçamento do cliente */
  month: { spent: number; budget: number | null; after: number } | null;
  blockers: string[];
  warnings: string[];
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** contagem de uma transmissão: alvos por situação + o que o WhatsApp confirmou */
export interface CampaignStats { total: number; pending: number; sent: number; delivered: number; read: number; failed: number; skipped: number }

@Injectable()
export class CampaignsService {
  private readonly log = new AppLogger('Campaigns');

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedules: SchedulesService,
    private readonly pacer: SendPacer,
    private readonly numbers: NumbersService,
    private readonly segmentation: SegmentationService,
    private readonly gateway: ConversationsGateway,
    private readonly usage: UsageService,
    private readonly pricing: PricingService,
    @InjectQueue(QUEUE_CAMPAIGN) private readonly queue: Queue<CampaignJob>,
  ) {}

  /** Quantos contatos o disparo atingiria — mostrado antes de criar, para não haver surpresa. */
  async preview(tenantId: string, a: Audience, numbers?: { in: string[] }) {
    const [contatos, grupos] = await Promise.all([
      this.segmentation.preview(tenantId, a, numbers),
      a.groupIds?.length ? this.prisma.whatsAppGroup.count({ where: { tenantId, id: { in: a.groupIds }, authorized: true, ...(numbers && { numberId: numbers }) } }) : Promise.resolve(0),
    ]);
    return { ...contatos, groups: grupos };
  }

  /** Previsão de uma transmissão ainda não criada: o público e o template da tela. */
  async estimateDraft(tenantId: string, dto: { numberId: string; audience: Audience; template?: { name: string; language: string } }, numbers?: { in: string[] }) {
    const number = await this.prisma.whatsAppNumber.findFirst({ where: { tenantId, deletedAt: null, AND: [{ id: dto.numberId }, ...(numbers ? [{ id: numbers }] : [])] } });
    if (!number) throw new NotFoundException('Número não encontrado');
    const { total } = await this.segmentation.preview(tenantId, dto.audience, numbers);
    return this.estimate(tenantId, number, total, dto.template ?? null);
  }

  /** Previsão de uma transmissão salva: só os alvos que ainda não receberam. */
  async estimateSaved(tenantId: string, id: string, numbers?: { in: string[] }) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, tenantId, ...(numbers && { numberId: numbers }) }, include: { number: true } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    const pendentes = await this.prisma.campaignTarget.count({ where: { campaignId: id, status: 'pending' } });
    return this.estimate(tenantId, campaign.number, pendentes, campaign.template as unknown as CampaignTemplate | null);
  }

  /**
   * O que a tela mostra antes de disparar pela API oficial: travas (número, template, plano),
   * custo previsto na Meta (alvos × preço da categoria do template), cota de templates do plano
   * e o gasto do mês contra o orçamento. QR Code não tem custo por mensagem.
   */
  async estimate(
    tenantId: string,
    number: { id: string; provider: string; status: string; label: string },
    recipients: number,
    tpl: { name: string; language: string } | null,
  ): Promise<CampaignEstimate> {
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (number.provider !== 'meta') return { provider: 'evolution', recipients, category: null, unitPrice: 0, total: 0, plan: null, month: null, blockers, warnings };

    if (number.status !== 'connected') blockers.push(`O número "${number.label}" está desconectado.`);
    let category: string | null = null;
    if (!tpl) blockers.push('Escolha um template aprovado pela Meta.');
    else {
      const def = await this.numbers.template(number.id, tpl.name, tpl.language).catch(() => null);
      if (!def) blockers.push(`O template "${tpl.name}" não está aprovado neste número.`);
      else {
        if (def.unsupported) blockers.push(def.unsupported);
        category = def.category;
      }
    }
    const pode = await this.usage.canSend(tenantId, 'templates', number.id);
    if (!pode.ok) blockers.push(pode.reason ?? 'O plano não permite enviar templates agora.');

    const unitPrice = category ? await this.pricing.unitCost('meta', category as 'marketing' | 'utility' | 'authentication') : 0;
    const total = Math.round(unitPrice * recipients * 100) / 100;

    // cota de templates do plano do Atendo (cobrança do Atendo, à parte da Meta)
    const [plano, usado] = await Promise.all([this.usage.limits(tenantId), this.usage.current(tenantId)]);
    const included = plano ? (plano.limits.includedTemplatesMonth ?? null) : null;
    const remaining = included === null ? null : Math.max(0, included - usado.templates);
    const hardLimit = !!plano?.limits.hardLimit;
    const overagePrice = plano?.limits.overagePricePerTemplate ?? null;
    const overageCount = remaining === null ? 0 : Math.max(0, recipients - remaining);
    if (overageCount > 0) {
      warnings.push(hardLimit || overagePrice == null
        ? `O plano tem ${remaining!.toLocaleString('pt-BR')} template(s) sobrando no mês: a transmissão pausa quando acabar e ${overageCount.toLocaleString('pt-BR')} contato(s) ficam sem receber.`
        : `${overageCount.toLocaleString('pt-BR')} template(s) passam do incluído no plano: ${brl(overageCount * overagePrice)} de excedente na próxima fatura do Atendo.`);
    }

    // mês com a Meta x orçamento
    const [gasto, t] = await Promise.all([this.usage.metaSpend(tenantId), this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { metaBudgetMonth: true } })]);
    const spent = Math.max(gasto.estimated, gasto.real.find((r) => r.currency === 'BRL')?.total ?? 0);
    const budget = t?.metaBudgetMonth != null ? Number(t.metaBudgetMonth) : null;
    const after = spent + total;
    if (budget && after > budget) warnings.push(`Com esta transmissão o gasto do mês com a Meta fica em ${brl(after)}, acima do orçamento de ${brl(budget)}.`);
    if (category === 'marketing') warnings.push('Template de marketing: a Meta limita quantas mensagens de marketing cada pessoa recebe de empresas. Parte pode não ser entregue (e não é cobrada).');
    if (!unitPrice && category) warnings.push('Sem preço cadastrado para esta categoria: o custo previsto pode estar abaixo do real.');

    return { provider: 'meta', recipients, category, unitPrice, total, plan: { included, remaining, hardLimit, overageCount, overagePrice }, month: { spent, budget, after }, blockers, warnings };
  }

  /** Grupos escolhidos: só os autorizados, do tenant e do número da transmissão (docs/grupos.md). */
  private async gruposDoPublico(tenantId: string, number: { id: string; provider: string }, ids?: string[]) {
    if (!ids?.length) return [];
    if (number.provider === 'meta') throw new BadRequestException('A API oficial não envia para grupos — use um número conectado por QR Code.');
    const rows = await this.prisma.whatsAppGroup.findMany({ where: { tenantId, numberId: number.id, id: { in: ids }, authorized: true }, select: { id: true } });
    if (rows.length !== new Set(ids).size) throw new BadRequestException('Algum grupo escolhido não está autorizado neste número. Autorize em Configurações → Grupos.');
    return rows.map((r) => r.id);
  }

  /**
   * Cria a transmissão como rascunho, com o público **materializado agora** (filtros +
   * seleção + importados). Iniciar é outro passo (`start`) — no QR, com o aceite do risco.
   */
  async create(tenantId: string, userId: string, dto: CreateCampaign, numbers?: { in: string[] }) {
    // restrito a empresas: só dispara pelos números dele (docs/empresas.md#transmissões)
    const number = await this.prisma.whatsAppNumber.findFirst({ where: { tenantId, deletedAt: null, AND: [{ id: dto.numberId }, ...(numbers ? [{ id: numbers }] : [])] } });
    if (!number) throw new NotFoundException('Número não encontrado');
    if (this.segmentation.isEmpty(dto.audience)) throw new BadRequestException('Escolha o público: filtros, contatos ou uma lista de telefones (ou "todos os contatos").');

    if (number.provider === 'meta') {
      // API oficial: campanha ativa = conversa iniciada pela empresa → só template aprovado
      if (!dto.template) throw new BadRequestException('Na API oficial a transmissão precisa de um template aprovado pela Meta.');
      const definition = await this.numbers.template(number.id, dto.template.name, dto.template.language);
      // o envio é por contato, minutos depois: o que falta no template recusa agora, não em cada envio
      if (definition.unsupported) throw new BadRequestException(definition.unsupported);
      if (templateHeaderMedia(definition) && !dto.template.headerMediaKey) throw new BadRequestException('Anexe o arquivo do cabeçalho do template.');
      if (dto.template.headerMediaKey && !dto.template.headerMediaKey.startsWith(`media/${tenantId}/`)) throw new BadRequestException('Arquivo do cabeçalho inválido');
      const semBotao = (definition.dynamicButtons ?? []).find((b) => !dto.template!.buttons?.[String(b.index)]?.trim());
      if (semBotao) throw new BadRequestException(`Preencha o valor do botão "${semBotao.text}".`);
    } else {
      if (dto.template) throw new BadRequestException('Template só existe na API oficial (Meta).');
      if (!dto.text?.trim() && !dto.mediaKey) throw new BadRequestException('Escreva a mensagem ou anexe um arquivo.');
    }
    if (dto.mediaKey && !dto.mediaKey.startsWith(`media/${tenantId}/`)) throw new BadRequestException('Anexo inválido');

    const groups = await this.gruposDoPublico(tenantId, number, dto.audience.groupIds);
    const contacts = await this.segmentation.resolve(tenantId, dto.audience, numbers);
    if (!contacts.length && !groups.length) throw new BadRequestException('Nenhum contato nesta seleção (descadastrados e números sem WhatsApp ficam de fora).');

    const campaign = await this.prisma.campaign.create({
      data: {
        tenantId,
        numberId: number.id,
        name: dto.name.trim(),
        text: dto.text?.trim() ?? '',
        mediaKey: number.provider === 'meta' ? null : (dto.mediaKey ?? null),
        mediaType: number.provider === 'meta' ? null : (dto.mediaType ?? null),
        mediaName: number.provider === 'meta' ? null : (dto.mediaName ?? null),
        template: (dto.template as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        startAt: dto.startAt ? new Date(dto.startAt) : null,
        // QR: horário comercial é obrigatório (trava antiban), não opcional
        businessHoursOnly: number.provider === 'meta' ? (dto.businessHoursOnly ?? true) : true,
        audience: dto.audience as unknown as Prisma.InputJsonValue,
        createdById: userId,
        targets: { createMany: { data: contacts.map((contactId) => ({ contactId })) } },
        groupTargets: { createMany: { data: groups.map((groupId) => ({ groupId })) } },
      },
      include: { _count: { select: { targets: true, groupTargets: true } } },
    });
    this.log.log(`Campanha "${campaign.name}" criada com ${campaign._count.targets} contatos e ${campaign._count.groupTargets} grupos`, { campaignId: campaign.id });
    return campaign;
  }

  /** Inicia (ou agenda). No QR exige o aceite do aviso de risco — gravado com quem e quando. */
  async start(tenantId: string, userId: string, id: string, acceptRisk?: boolean, numbers?: { in: string[] }) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, tenantId, ...(numbers && { numberId: numbers }) }, include: { number: true } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    if (campaign.status === 'done' || campaign.status === 'canceled') throw new BadRequestException('Esta campanha já terminou.');
    if (campaign.number.status !== 'connected') throw new BadRequestException(`O número "${campaign.number.label}" está desconectado.`);
    const qr = campaign.number.provider !== 'meta';
    if (!qr) {
      // API oficial: mesmas travas da previsão que a tela mostrou (template, plano)
      const pendentes = await this.prisma.campaignTarget.count({ where: { campaignId: id, status: 'pending' } });
      const prev = await this.estimate(tenantId, campaign.number, pendentes, campaign.template as unknown as CampaignTemplate | null);
      if (prev.blockers.length) throw new BadRequestException(prev.blockers[0]);
    }
    if (qr && !acceptRisk && !campaign.riskAcceptedAt) {
      throw new BadRequestException({ code: 'qr_risk_not_accepted', message: 'Aceite o aviso de segurança do QR Code para iniciar a transmissão.' });
    }
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        status: campaign.startAt && campaign.startAt > new Date() ? 'scheduled' : 'running',
        startedAt: campaign.startedAt ?? new Date(),
        pauseReason: null,
        ...(qr && !campaign.riskAcceptedAt && { riskAcceptedAt: new Date(), riskAcceptedById: userId }),
      },
    });
    await this.enqueue(id);
    this.gateway.emitCampaign(tenantId, { id, status: updated.status });
    return updated;
  }

  async setStatus(tenantId: string, id: string, status: 'paused' | 'running' | 'canceled', numbers?: { in: string[] }) {
    const atual = await this.prisma.campaign.findFirst({ where: { id, tenantId, ...(numbers && { numberId: numbers }) } });
    if (!atual) throw new NotFoundException('Campanha não encontrada');
    if (atual.status === 'done' || atual.status === 'canceled') throw new BadRequestException('Esta campanha já terminou.');
    if (status === 'running' && atual.status === 'draft') throw new BadRequestException('Use "Iniciar" para começar a transmissão.');
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status, ...(status === 'canceled' && { finishedAt: new Date() }), ...(status === 'running' && { pauseReason: null }) },
    });
    if (status === 'running') await this.enqueue(id);
    if (status !== 'running') await this.queue.remove(id).catch(() => undefined);
    this.gateway.emitCampaign(tenantId, { id, status });
    return updated;
  }

  /** Parou sozinha (3 falhas seguidas): grava o motivo e avisa quem estiver com o painel aberto. */
  async autoPause(tenantId: string, id: string, name: string, reason: string) {
    await this.prisma.campaign.update({ where: { id }, data: { status: 'paused', pauseReason: reason } });
    this.gateway.emitCampaign(tenantId, { id, status: 'paused', name, alert: reason });
    this.log.warn(`Campanha ${id} pausada automaticamente: ${reason}`);
  }

  /** Lote processado / terminou: a tela atualiza a barra de progresso sem ficar consultando. */
  emitProgress(tenantId: string, id: string, status = 'running') {
    this.gateway.emitCampaign(tenantId, { id, status });
  }

  /**
   * Um job por campanha, com id fixo. Sem isso, retomar uma campanha pausada duas vezes
   * criaria dois despachantes para a mesma fila e o contato receberia em dobro.
   */
  async enqueue(campaignId: string, delay = 0) {
    await this.queue.remove(campaignId).catch(() => undefined);
    await this.queue.add('dispatch', { campaignId }, { jobId: campaignId, delay, removeOnComplete: true, removeOnFail: 50 });
  }

  /** Contagens por campanha, juntando o status da mensagem (entregue/lida/falhou no WhatsApp). */
  private async stats(campaignIds: string[]): Promise<Map<string, CampaignStats>> {
    if (!campaignIds.length) return new Map();
    const rows = await this.prisma.$queryRaw<{ id: string; total: number; pending: number; sent: number; delivered: number; read: number; failed: number; skipped: number }[]>(Prisma.sql`
      select t."campaignId" as id, count(*)::int as total,
        count(*) filter (where t.status = 'pending')::int as pending,
        count(*) filter (where t.status = 'sent' and coalesce(m.status::text, '') <> 'failed')::int as sent,
        count(*) filter (where m.status in ('delivered', 'read'))::int as delivered,
        count(*) filter (where m.status = 'read')::int as read,
        count(*) filter (where t.status = 'failed' or m.status = 'failed')::int as failed,
        count(*) filter (where t.status = 'skipped')::int as skipped
      from (
        select "campaignId", status, "messageId" from campaign_targets where "campaignId" in (${Prisma.join(campaignIds)})
        -- grupos (docs/grupos.md): sem linha em messages, então "enviado" é o máximo que se sabe
        union all select "campaignId", status, null from campaign_group_targets where "campaignId" in (${Prisma.join(campaignIds)})
      ) t left join messages m on m.id = t."messageId"
      group by 1
    `);
    return new Map(rows.map((r) => [r.id, { total: r.total, pending: r.pending, sent: r.sent, delivered: r.delivered, read: r.read, failed: r.failed, skipped: r.skipped }]));
  }

  async list(tenantId: string, numbers?: { in: string[] }) {
    const rows = await this.prisma.campaign.findMany({
      where: { tenantId, ...(numbers && { numberId: numbers }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { number: { select: { label: true, provider: true } } },
    });
    const stats = await this.stats(rows.map((c) => c.id));
    return rows.map((c) => ({ ...c, stats: stats.get(c.id) ?? { total: 0, pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 } }));
  }

  async one(tenantId: string, id: string, numbers?: { in: string[] }) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, tenantId, ...(numbers && { numberId: numbers }) }, include: { number: { select: { id: true, label: true, phone: true, provider: true } } } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    const [stats, amostra, dia] = await Promise.all([
      this.stats([id]),
      // alvo que falhou/foi ignorado aqui OU mensagem que o WhatsApp recusou depois
      this.prisma.$queryRaw<{ contato: string; status: string; motivo: string | null }[]>(Prisma.sql`
        select coalesce(c.name, c.phone) as contato, case when m.status = 'failed' then 'failed' else t.status::text end as status, coalesce(t.error, m.error) as motivo
        from campaign_targets t join contacts c on c.id = t."contactId" left join messages m on m.id = t."messageId"
        where t."campaignId" = ${id} and (t.status in ('failed', 'skipped') or m.status = 'failed')
        union all
        select 'Grupo ' || g.name as contato, gt.status::text as status, gt.error as motivo
        from campaign_group_targets gt join whatsapp_groups g on g.id = gt."groupId"
        where gt."campaignId" = ${id} and gt.status in ('failed', 'skipped')
        limit 50
      `),
      this.dailyUsage(campaign.number.id),
    ]);
    return {
      ...campaign,
      stats: stats.get(id),
      daily: dia,
      problemas: amostra,
    };
  }

  /**
   * Transmissão do número nas últimas 24h e o teto dele (QR). Janela móvel: o teto vale para
   * qualquer período de 24h, não "zera à meia-noite" (que permitiria 2× o teto em poucas horas).
   */
  async dailyUsage(numberId: string) {
    const number = await this.prisma.whatsAppNumber.findUniqueOrThrow({ where: { id: numberId }, select: { provider: true, campaignDailyLimit: true } });
    const desde = new Date(Date.now() - QR_WINDOW_MS);
    const [contatos, grupos] = await Promise.all([
      this.prisma.campaignTarget.count({ where: { campaign: { numberId }, sentAt: { gte: desde }, status: { in: ['sent', 'failed'] } } }),
      // envio para grupo conta no mesmo teto de transmissão do número
      this.prisma.campaignGroupTarget.count({ where: { campaign: { numberId }, sentAt: { gte: desde }, status: { in: ['sent', 'failed'] } } }),
    ]);
    const sent = contatos + grupos;
    return { sent, limit: number.provider === 'meta' ? null : number.campaignDailyLimit };
  }

  /** Quanto ainda cabe agora: teto geral de envios proativos do número e, no QR, o de transmissão. */
  async dailyRemaining(numberId: string) {
    const number = await this.prisma.whatsAppNumber.findUniqueOrThrow({
      where: { id: numberId },
      select: { id: true, provider: true, sendDailyLimit: true, warmupStartedAt: true },
    });
    const day = await this.pacer.dailyStatus(number);
    const geral = day.limit === 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, day.limit - day.sent);
    const { sent, limit } = await this.dailyUsage(numberId);
    return limit == null ? geral : Math.min(geral, Math.max(0, limit - sent));
  }

  /** "Só no horário de atendimento": quadro de horários do número da campanha (ou o padrão). */
  isOpen(tenantId: string, numberId?: string) {
    return this.schedules.isOpen(tenantId, numberId);
  }
}
