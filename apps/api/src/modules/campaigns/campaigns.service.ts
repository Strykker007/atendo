import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SchedulesService } from '../tenants/schedules.service';
import { SendPacer } from '../whatsapp/send-pacer';
import { AppLogger } from '../../common/observability/app-logger';
import { QUEUE_CAMPAIGN, type CampaignJob } from './queues';

export interface Audience {
  kind: 'all' | 'tags' | 'contacts';
  tagIds?: string[];
  contactIds?: string[];
}

@Injectable()
export class CampaignsService {
  private readonly log = new AppLogger('Campaigns');

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedules: SchedulesService,
    private readonly pacer: SendPacer,
    @InjectQueue(QUEUE_CAMPAIGN) private readonly queue: Queue<CampaignJob>,
  ) {}

  /**
   * Quem vai receber. A lista é **materializada agora**, não resolvida no envio: quem entrar
   * na etiqueta depois não deve receber um disparo que já começou, e o relatório precisa ser
   * estável para o cliente conferir o que foi mandado.
   */
  private audienceWhere(tenantId: string, a: Audience): Prisma.ContactWhereInput {
    const base: Prisma.ContactWhereInput = { tenantId, optOutAt: null };
    if (a.kind === 'contacts') return { ...base, id: { in: a.contactIds ?? [] } };
    if (a.kind === 'tags') return { ...base, tags: { some: { tagId: { in: a.tagIds ?? [] } } } };
    return base;
  }

  /** Quantos contatos o disparo atingiria — mostrado antes de criar, para não haver surpresa. */
  async preview(tenantId: string, a: Audience) {
    const where = this.audienceWhere(tenantId, a);
    const [total, optOut] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.count({ where: { ...where, optOutAt: { not: null } } }),
    ]);
    return { total, optOut };
  }

  async create(
    tenantId: string,
    userId: string,
    dto: { name: string; numberId: string; text: string; mediaKey?: string; mediaType?: string; mediaName?: string; template?: unknown; startAt?: string; businessHoursOnly?: boolean; audience: Audience },
  ) {
    const number = await this.prisma.whatsAppNumber.findFirst({ where: { id: dto.numberId, tenantId, deletedAt: null } });
    if (!number) throw new NotFoundException('Número não encontrado');

    const contacts = await this.prisma.contact.findMany({ where: this.audienceWhere(tenantId, dto.audience), select: { id: true } });
    if (!contacts.length) throw new BadRequestException('Nenhum contato nesta seleção.');

    const campaign = await this.prisma.campaign.create({
      data: {
        tenantId,
        numberId: dto.numberId,
        name: dto.name.trim(),
        text: dto.text,
        mediaKey: dto.mediaKey ?? null,
        mediaType: dto.mediaType ?? null,
        mediaName: dto.mediaName ?? null,
        template: (dto.template as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        startAt: dto.startAt ? new Date(dto.startAt) : null,
        businessHoursOnly: dto.businessHoursOnly ?? true,
        createdById: userId,
        targets: { createMany: { data: contacts.map((c) => ({ contactId: c.id })) } },
      },
      include: { _count: { select: { targets: true } } },
    });
    this.log.log(`Campanha "${campaign.name}" criada com ${campaign._count.targets} alvos`, { campaignId: campaign.id });
    return campaign;
  }

  async start(tenantId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, tenantId } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    if (campaign.status === 'done' || campaign.status === 'canceled') throw new BadRequestException('Esta campanha já terminou.');

    const number = await this.prisma.whatsAppNumber.findUniqueOrThrow({ where: { id: campaign.numberId } });
    if (number.status !== 'connected') throw new BadRequestException(`O número "${number.label}" está desconectado.`);
    // transmissão é envio frio por definição (docs/envio.md#envio-frio): só pelo número oficial
    if (number.provider !== 'meta') throw new BadRequestException(`Transmissão em massa só sai por número Meta Cloud API. Pela Conexão Web (QR Code) ela é a causa nº 1 de bloqueio — troque o número da campanha.`);

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: campaign.startAt && campaign.startAt > new Date() ? 'scheduled' : 'running', startedAt: campaign.startedAt ?? new Date() },
    });
    await this.enqueue(id);
    return updated;
  }

  async setStatus(tenantId: string, id: string, status: 'paused' | 'running' | 'canceled') {
    await this.prisma.campaign.findFirstOrThrow({ where: { id, tenantId } });
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status, ...(status === 'canceled' && { finishedAt: new Date() }) },
    });
    if (status === 'running') await this.enqueue(id);
    return updated;
  }

  /**
   * Um job por campanha, com id fixo. Sem isso, retomar uma campanha pausada duas vezes
   * criaria dois despachantes para a mesma fila e o contato receberia em dobro.
   */
  async enqueue(campaignId: string, delay = 0) {
    await this.queue.remove(campaignId).catch(() => undefined);
    await this.queue.add('dispatch', { campaignId }, { jobId: campaignId, delay, removeOnComplete: true, removeOnFail: 50 });
  }

  async list(tenantId: string) {
    const rows = await this.prisma.campaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { number: { select: { label: true } } },
    });
    const counts = await this.prisma.campaignTarget.groupBy({
      by: ['campaignId', 'status'],
      where: { campaign: { tenantId } },
      _count: { _all: true },
    });
    return rows.map((c) => ({
      ...c,
      stats: counts.filter((x) => x.campaignId === c.id).reduce((acc, x) => ({ ...acc, [x.status]: x._count._all }), {} as Record<string, number>),
    }));
  }

  async one(tenantId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, tenantId }, include: { number: { select: { label: true, phone: true } } } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    const [stats, amostra] = await Promise.all([
      this.prisma.campaignTarget.groupBy({ by: ['status'], where: { campaignId: id }, _count: { _all: true } }),
      this.prisma.campaignTarget.findMany({
        where: { campaignId: id, status: { in: ['failed', 'skipped'] } },
        take: 50,
        include: { contact: { select: { name: true, phone: true } } },
      }),
    ]);
    return {
      ...campaign,
      stats: stats.reduce((acc, x) => ({ ...acc, [x.status]: x._count._all }), {} as Record<string, number>),
      problemas: amostra.map((t) => ({ contato: t.contact.name ?? t.contact.phone, status: t.status, motivo: t.error })),
    };
  }

  /** Teto diário que ainda sobra para este número agora. */
  async dailyRemaining(numberId: string) {
    const number = await this.prisma.whatsAppNumber.findUniqueOrThrow({
      where: { id: numberId },
      select: { id: true, provider: true, sendDailyLimit: true, warmupStartedAt: true },
    });
    const day = await this.pacer.dailyStatus(number);
    return day.limit === 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, day.limit - day.sent);
  }

  /** "Só no horário de atendimento": quadro de horários do número da campanha (ou o padrão). */
  isOpen(tenantId: string, numberId?: string) {
    return this.schedules.isOpen(tenantId, numberId);
  }
}
