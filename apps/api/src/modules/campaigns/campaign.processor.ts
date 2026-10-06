import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { enrichContext } from '../../common/observability/request-context';
import { interpolate } from '../flows/answer';
import { InterpolationService } from '../../common/interpolation/interpolation.service';
import { CampaignsService } from './campaigns.service';
import { afterBatch, decideDispatch, eligible, type CampaignStatus } from './dispatch';
import { QUEUE_CAMPAIGN, type CampaignJob } from './queues';

/**
 * Despachante da transmissão. **Não envia**: cria as mensagens e as entrega à fila de saída,
 * que já tem intervalo aleatório entre envios, teto diário e aquecimento do número. Um
 * caminho de envio próprio perderia essa proteção, que é o que impede o banimento.
 *
 * Trabalha em lotes pequenos e se reagenda. Cada lote reconsulta status, horário e teto do
 * dia, então pausar uma campanha a interrompe em segundos — e nada é pré-agendado para
 * horas à frente, que seria impossível de parar.
 */
@Processor(QUEUE_CAMPAIGN, { concurrency: 5 })
export class CampaignProcessor extends TrackedWorkerHost<CampaignJob> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly conversations: ConversationsService,
    private readonly interpolation: InterpolationService,
  ) {
    super(QUEUE_CAMPAIGN);
  }

  protected async handle(job: Job<CampaignJob>) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: job.data.campaignId },
      include: { number: { select: { id: true, provider: true, status: true, label: true } } },
    });
    if (!campaign) return;
    enrichContext({ tenantId: campaign.tenantId });

    const pending = await this.prisma.campaignTarget.count({ where: { campaignId: campaign.id, status: 'pending' } });
    const [isOpen, dailyRemaining] = await Promise.all([
      campaign.businessHoursOnly ? this.campaigns.isOpen(campaign.tenantId, campaign.numberId) : Promise.resolve(true),
      this.campaigns.dailyRemaining(campaign.numberId),
    ]);

    const decision = decideDispatch({
      now: Date.now(),
      status: campaign.status as CampaignStatus,
      startAt: campaign.startAt?.getTime() ?? null,
      businessHoursOnly: campaign.businessHoursOnly,
      isOpen,
      dailyRemaining,
      pending,
    });

    if (decision.action === 'stop') return this.log.log(`Campanha ${campaign.id}: ${decision.reason}`);
    if (decision.action === 'done') return this.finish(campaign.id);
    if (decision.action === 'wait') {
      this.log.debug(`Campanha ${campaign.id}: ${decision.reason} — novo lote em ${Math.round(decision.retryInMs / 1000)}s`);
      // o número desconectar no meio não cancela: a campanha espera ele voltar
      if (campaign.status === 'scheduled') await this.prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'running' } }).catch(() => undefined);
      return this.campaigns.enqueue(campaign.id, decision.retryInMs);
    }

    // número caiu no meio do disparo: espera, não falha os alvos restantes
    if (campaign.number.status !== 'connected') {
      this.log.warn(`Campanha ${campaign.id}: número "${campaign.number.label}" desconectado — aguardando`);
      return this.campaigns.enqueue(campaign.id, 5 * 60_000);
    }

    const targets = await this.prisma.campaignTarget.findMany({
      where: { campaignId: campaign.id, status: 'pending' },
      take: decision.take,
      include: { contact: { select: { id: true, name: true, phone: true, optOutAt: true } } },
    });

    for (const target of targets) {
      const last = await this.lastInboundAt(campaign.numberId, target.contactId);
      const check = eligible({
        provider: campaign.number.provider as 'meta' | 'evolution',
        hasTemplate: !!campaign.template,
        lastInboundAt: last,
        optedOut: !!target.contact.optOutAt,
        now: Date.now(),
      });

      if (!check.ok) {
        await this.prisma.campaignTarget.update({ where: { id: target.id }, data: { status: 'skipped', error: check.reason } });
        continue;
      }

      try {
        const text = interpolate(campaign.text, await this.interpolation.context(campaign.tenantId, target.contact));
        const message = await this.conversations.sendToContact(campaign.tenantId, target.contactId, text, { preferredNumberId: campaign.numberId, idempotencyKey: `campaign-${campaign.id}-${target.id}` });
        await this.prisma.campaignTarget.update({
          where: { id: target.id },
          data: { status: 'sent', messageId: (message as { id?: string })?.id ?? null, sentAt: new Date(), error: null },
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        // falha de um contato não derruba o lote: o relatório mostra quem ficou de fora
        await this.prisma.campaignTarget.update({ where: { id: target.id }, data: { status: 'failed', error } });
        this.log.warn(`Campanha ${campaign.id}: falha em ${target.contactId} — ${error}`);
      }
    }

    const restante = await this.prisma.campaignTarget.count({ where: { campaignId: campaign.id, status: 'pending' } });
    const next = afterBatch(restante);
    if (next.action === 'done') return this.finish(campaign.id);
    return this.campaigns.enqueue(campaign.id, next.retryInMs);
  }

  /** Última mensagem recebida deste contato neste número — base da janela de 24h da Meta. */
  private async lastInboundAt(numberId: string, contactId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { numberId, contactId, lastInboundAt: { not: null } },
      orderBy: { lastInboundAt: 'desc' },
      select: { lastInboundAt: true },
    });
    return conv?.lastInboundAt?.getTime() ?? null;
  }

  private async finish(id: string) {
    await this.prisma.campaign.update({ where: { id }, data: { status: 'done', finishedAt: new Date() } }).catch(() => undefined);
    this.log.log(`Campanha ${id} concluída`);
  }
}
