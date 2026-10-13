import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SchedulesService } from '../tenants/schedules.service';
import { SendPacer } from '../whatsapp/send-pacer';
import { NumbersService } from '../whatsapp/numbers.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { AppLogger } from '../../common/observability/app-logger';
import { QUEUE_CAMPAIGN, type CampaignJob } from './queues';
import { SegmentationService, type Audience } from './segmentation.service';
import { QR_WINDOW_MS } from './dispatch';

export type { Audience } from './segmentation.service';

/** escolha de template salva na campanha (Meta) — a mesma do envio manual */
export interface CampaignTemplate { name: string; language: string; header?: Record<string, string>; body?: Record<string, string> }

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
    @InjectQueue(QUEUE_CAMPAIGN) private readonly queue: Queue<CampaignJob>,
  ) {}

  /** Quantos contatos o disparo atingiria — mostrado antes de criar, para não haver surpresa. */
  preview(tenantId: string, a: Audience) {
    return this.segmentation.preview(tenantId, a);
  }

  /**
   * Cria a transmissão como rascunho, com o público **materializado agora** (filtros +
   * seleção + importados). Iniciar é outro passo (`start`) — no QR, com o aceite do risco.
   */
  async create(tenantId: string, userId: string, dto: CreateCampaign) {
    const number = await this.prisma.whatsAppNumber.findFirst({ where: { id: dto.numberId, tenantId, deletedAt: null } });
    if (!number) throw new NotFoundException('Número não encontrado');
    if (this.segmentation.isEmpty(dto.audience)) throw new BadRequestException('Escolha o público: filtros, contatos ou uma lista de telefones (ou "todos os contatos").');

    if (number.provider === 'meta') {
      // API oficial: campanha ativa = conversa iniciada pela empresa → só template aprovado
      if (!dto.template) throw new BadRequestException('Na API oficial a transmissão precisa de um template aprovado pela Meta.');
      await this.numbers.template(number.id, dto.template.name, dto.template.language);
    } else {
      if (dto.template) throw new BadRequestException('Template só existe na API oficial (Meta).');
      if (!dto.text?.trim() && !dto.mediaKey) throw new BadRequestException('Escreva a mensagem ou anexe um arquivo.');
    }
    if (dto.mediaKey && !dto.mediaKey.startsWith(`media/${tenantId}/`)) throw new BadRequestException('Anexo inválido');

    const contacts = await this.segmentation.resolve(tenantId, dto.audience);
    if (!contacts.length) throw new BadRequestException('Nenhum contato nesta seleção (descadastrados e números sem WhatsApp ficam de fora).');

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
      },
      include: { _count: { select: { targets: true } } },
    });
    this.log.log(`Campanha "${campaign.name}" criada com ${campaign._count.targets} alvos`, { campaignId: campaign.id });
    return campaign;
  }

  /** Inicia (ou agenda). No QR exige o aceite do aviso de risco — gravado com quem e quando. */
  async start(tenantId: string, userId: string, id: string, acceptRisk?: boolean) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, tenantId }, include: { number: true } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    if (campaign.status === 'done' || campaign.status === 'canceled') throw new BadRequestException('Esta campanha já terminou.');
    if (campaign.number.status !== 'connected') throw new BadRequestException(`O número "${campaign.number.label}" está desconectado.`);
    const qr = campaign.number.provider !== 'meta';
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

  async setStatus(tenantId: string, id: string, status: 'paused' | 'running' | 'canceled') {
    const atual = await this.prisma.campaign.findFirst({ where: { id, tenantId } });
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
      from campaign_targets t left join messages m on m.id = t."messageId"
      where t."campaignId" in (${Prisma.join(campaignIds)})
      group by 1
    `);
    return new Map(rows.map((r) => [r.id, { total: r.total, pending: r.pending, sent: r.sent, delivered: r.delivered, read: r.read, failed: r.failed, skipped: r.skipped }]));
  }

  async list(tenantId: string) {
    const rows = await this.prisma.campaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { number: { select: { label: true, provider: true } } },
    });
    const stats = await this.stats(rows.map((c) => c.id));
    return rows.map((c) => ({ ...c, stats: stats.get(c.id) ?? { total: 0, pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 } }));
  }

  async one(tenantId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, tenantId }, include: { number: { select: { id: true, label: true, phone: true, provider: true } } } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    const [stats, amostra, dia] = await Promise.all([
      this.stats([id]),
      // alvo que falhou/foi ignorado aqui OU mensagem que o WhatsApp recusou depois
      this.prisma.$queryRaw<{ contato: string; status: string; motivo: string | null }[]>(Prisma.sql`
        select coalesce(c.name, c.phone) as contato, case when m.status = 'failed' then 'failed' else t.status::text end as status, coalesce(t.error, m.error) as motivo
        from campaign_targets t join contacts c on c.id = t."contactId" left join messages m on m.id = t."messageId"
        where t."campaignId" = ${id} and (t.status in ('failed', 'skipped') or m.status = 'failed')
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
    const sent = await this.prisma.campaignTarget.count({ where: { campaign: { numberId }, sentAt: { gte: new Date(Date.now() - QR_WINDOW_MS) }, status: { in: ['sent', 'failed'] } } });
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
