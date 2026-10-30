import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { NumbersService } from '../whatsapp/numbers.service';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { enrichContext } from '../../common/observability/request-context';
import { interpolate } from '../flows/answer';
import { InterpolationService } from '../../common/interpolation/interpolation.service';
import { CampaignsService, type CampaignTemplate } from './campaigns.service';
import { afterBatch, decideDispatch, eligible, failureStreak, FAILURE_STREAK, qrDelay, type CampaignStatus } from './dispatch';
import { QUEUE_CAMPAIGN, type CampaignJob } from './queues';
import { GroupSender } from './group-sender';
import { UsageService } from '../billing/usage.service';

type MediaType = 'image' | 'document' | 'audio' | 'video';

/**
 * Despachante da transmissão (docs/envio.md#transmissão). **Não envia direto**: cria as
 * mensagens e as entrega à fila de saída, que já tem ritmo, teto diário e aquecimento.
 *
 * Duas velocidades:
 *  - **QR Code**: UMA mensagem por job, o próximo daqui a 20–60 s (sorteado). Horário
 *    comercial obrigatório, teto de transmissão por 24h do número (`campaignDailyLimit`) e
 *    pausa automática com 3 falhas seguidas (sessão caiu / número sendo bloqueado).
 *  - **API oficial**: lotes de 25 com template aprovado; o limite é o tier da Meta.
 *
 * Cada job reconsulta status, horário e teto, então pausar interrompe na hora — nada é
 * pré-agendado para horas à frente.
 */
@Processor(QUEUE_CAMPAIGN, { concurrency: 5 })
export class CampaignProcessor extends TrackedWorkerHost<CampaignJob> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly conversations: ConversationsService,
    private readonly numbers: NumbersService,
    private readonly interpolation: InterpolationService,
    private readonly groups: GroupSender,
    private readonly usage: UsageService,
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
    const qr = campaign.number.provider !== 'meta';

    const pending = await this.pendentes(campaign.id);
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
      qr,
    });

    if (decision.action === 'stop') return this.log.log(`Campanha ${campaign.id}: ${decision.reason}`);
    if (decision.action === 'done') return this.finish(campaign.tenantId, campaign.id);
    if (decision.action === 'wait') {
      this.log.debug(`Campanha ${campaign.id}: ${decision.reason} — novo lote em ${Math.round(decision.retryInMs / 1000)}s`);
      if (campaign.status === 'scheduled') await this.prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'running' } }).catch(() => undefined);
      return this.campaigns.enqueue(campaign.id, decision.retryInMs);
    }

    // número caiu no meio do disparo: espera, não falha os alvos restantes
    if (campaign.number.status !== 'connected') {
      this.log.warn(`Campanha ${campaign.id}: número "${campaign.number.label}" desconectado — aguardando`);
      return this.campaigns.enqueue(campaign.id, 5 * 60_000);
    }

    // 3 falhas seguidas (inclusive as que o WhatsApp recusou depois de enfileiradas): para tudo
    if (qr && failureStreak(await this.ultimosResultados(campaign.id))) {
      return this.campaigns.autoPause(campaign.tenantId, campaign.id, campaign.name, `${FAILURE_STREAK} envios seguidos falharam — a sessão pode ter caído ou o número estar sendo bloqueado. Confira o número antes de retomar.`);
    }
    if (campaign.status === 'scheduled') await this.prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'running' } }).catch(() => undefined);

    const tpl = campaign.template as unknown as CampaignTemplate | null;
    // definição aprovada do template, uma vez por lote (os valores por contato saem dela)
    const definition = tpl ? await this.numbers.template(campaign.numberId, tpl.name, tpl.language).catch(() => null) : null;
    if (tpl && !definition) {
      return this.campaigns.autoPause(campaign.tenantId, campaign.id, campaign.name, `O template "${tpl.name}" não está mais aprovado neste número. Escolha outro e crie a transmissão de novo.`);
    }

    // API oficial: cota de templates do plano acabou no meio → pausa com o motivo, em vez de
    // falhar contato a contato (docs/gasto-meta.md#transmissão)
    if (tpl) {
      const pode = await this.usage.canSend(campaign.tenantId, 'templates', campaign.numberId);
      if (!pode.ok) return this.campaigns.autoPause(campaign.tenantId, campaign.id, campaign.name, pode.reason ?? 'O plano não permite enviar mais templates neste mês.');
    }

    const targets = await this.prisma.campaignTarget.findMany({
      where: { campaignId: campaign.id, status: 'pending' },
      take: decision.take,
      include: { contact: { select: { id: true, name: true, phone: true, optOutAt: true } } },
    });

    for (const target of targets) {
      const check = eligible({
        provider: campaign.number.provider as 'meta' | 'evolution',
        hasTemplate: !!tpl,
        lastInboundAt: await this.lastInboundAt(campaign.numberId, target.contactId),
        optedOut: !!target.contact.optOutAt,
        now: Date.now(),
      });
      if (!check.ok) {
        await this.prisma.campaignTarget.update({ where: { id: target.id }, data: { status: 'skipped', error: check.reason } });
        continue;
      }

      try {
        const idempotencyKey = `campaign-${campaign.id}-${target.id}`;
        let message;
        if (tpl && definition) {
          const built = await this.conversations.templateMessage(campaign.tenantId, target.contactId, definition, tpl);
          message = await this.conversations.sendCampaign(campaign.tenantId, target.contactId, campaign.numberId, { text: built.text, media: built.systemMedia, template: built.template!, idempotencyKey });
        } else {
          const text = campaign.text ? interpolate(campaign.text, await this.interpolation.context(campaign.tenantId, target.contact)) : undefined;
          const media = campaign.mediaKey ? { key: campaign.mediaKey, type: (campaign.mediaType ?? 'document') as MediaType, name: campaign.mediaName ?? undefined } : undefined;
          message = await this.conversations.sendCampaign(campaign.tenantId, target.contactId, campaign.numberId, { text, media, idempotencyKey });
        }
        await this.prisma.campaignTarget.update({
          where: { id: target.id },
          data: { status: 'sent', messageId: (message as { id?: string })?.id ?? null, sentAt: new Date(), error: null },
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        // falha de um contato não derruba o lote; `sentAt` marca quando foi processado (conta no teto e na sequência de falhas)
        await this.prisma.campaignTarget.update({ where: { id: target.id }, data: { status: 'failed', error, sentAt: new Date() } });
        this.log.warn(`Campanha ${campaign.id}: falha em ${target.contactId} — ${error}`);
      }
    }

    // grupos autorizados (docs/grupos.md) vêm depois dos contatos, no mesmo ritmo e com as mesmas travas
    const vagas = decision.take - targets.length;
    if (vagas > 0) {
      const espera = await this.enviarGrupos(campaign, vagas);
      if (espera) {
        this.campaigns.emitProgress(campaign.tenantId, campaign.id);
        this.log.debug(`Campanha ${campaign.id}: grupo aguardando (${espera.reason}) — ${Math.round(espera.retryInMs / 1000)}s`);
        return this.campaigns.enqueue(campaign.id, Math.max(espera.retryInMs, qr ? qrDelay() : 0));
      }
    }

    this.campaigns.emitProgress(campaign.tenantId, campaign.id);
    const restante = await this.pendentes(campaign.id);
    const next = afterBatch(restante);
    if (next.action === 'done') return this.finish(campaign.tenantId, campaign.id);
    // QR: o próximo daqui a 20–60 s; Meta: próximo lote no intervalo normal
    return this.campaigns.enqueue(campaign.id, qr ? qrDelay() : next.retryInMs);
  }

  /** Alvos ainda não processados: contatos + grupos. */
  private async pendentes(campaignId: string) {
    const [contatos, grupos] = await Promise.all([
      this.prisma.campaignTarget.count({ where: { campaignId, status: 'pending' } }),
      this.prisma.campaignGroupTarget.count({ where: { campaignId, status: 'pending' } }),
    ]);
    return contatos + grupos;
  }

  /**
   * Envia aos grupos pendentes (até `take`). Devolve a espera quando uma trava antiban pediu
   * para aguardar — o alvo continua pendente e a campanha volta à fila.
   */
  private async enviarGrupos(campaign: { id: string; tenantId: string; numberId: string; text: string; mediaKey: string | null; mediaType: string | null; mediaName: string | null }, take: number) {
    const alvos = await this.prisma.campaignGroupTarget.findMany({
      where: { campaignId: campaign.id, status: 'pending' },
      take,
      include: { group: { select: { id: true, jid: true, authorized: true } } },
    });
    // texto vai sem dados de contato: num grupo não há "primeiro nome" de quem lê ({{contact.*}} sai vazio)
    const vars = campaign.text ? await this.interpolation.context(campaign.tenantId, { id: '', name: null, phone: '' }) : null;
    const text = campaign.text && vars ? interpolate(campaign.text, vars) : undefined;
    for (const target of alvos) {
      const media = campaign.mediaKey ? { key: campaign.mediaKey, type: (campaign.mediaType ?? 'document') as MediaType, name: campaign.mediaName ?? undefined } : undefined;
      const r = await this.groups.send({ tenantId: campaign.tenantId, numberId: campaign.numberId, target, text, media });
      if (r.status === 'wait') return r;
      await this.prisma.campaignGroupTarget.update({
        where: { id: target.id },
        data: r.status === 'sent' ? { status: 'sent', externalId: r.externalId, sentAt: new Date(), error: null } : { status: 'failed', error: r.error, sentAt: new Date() },
      });
      if (r.status === 'failed') this.log.warn(`Campanha ${campaign.id}: falha no grupo ${target.group.id} — ${r.error}`);
    }
    return null;
  }

  /**
   * Resultado dos últimos envios processados, mais recente primeiro: falhou aqui (alvo `failed`)
   * ou o WhatsApp recusou depois (mensagem `failed`). Ignorados (descadastro, janela) não contam.
   */
  private async ultimosResultados(campaignId: string): Promise<('ok' | 'failed')[]> {
    const ultimos = await this.prisma.campaignTarget.findMany({
      where: { campaignId, status: { in: ['sent', 'failed'] }, sentAt: { not: null } },
      orderBy: { sentAt: 'desc' },
      take: FAILURE_STREAK,
      select: { status: true, messageId: true, sentAt: true },
    });
    const ids = ultimos.map((t) => t.messageId).filter((x): x is string => !!x);
    const falhas = new Set((await this.prisma.message.findMany({ where: { id: { in: ids }, status: 'failed' }, select: { id: true } })).map((m) => m.id));
    const grupos = await this.prisma.campaignGroupTarget.findMany({
      where: { campaignId, status: { in: ['sent', 'failed'] }, sentAt: { not: null } },
      orderBy: { sentAt: 'desc' },
      take: FAILURE_STREAK,
      select: { status: true, sentAt: true },
    });
    // contatos e grupos na mesma linha do tempo: 3 falhas seguidas em qualquer mistura param tudo
    return [
      ...ultimos.map((t) => ({ at: t.sentAt!.getTime(), r: (t.status === 'failed' || (t.messageId && falhas.has(t.messageId)) ? 'failed' : 'ok') as 'ok' | 'failed' })),
      ...grupos.map((g) => ({ at: g.sentAt!.getTime(), r: g.status === 'failed' ? ('failed' as const) : ('ok' as const) })),
    ].sort((a, b) => b.at - a.at).slice(0, FAILURE_STREAK).map((x) => x.r);
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

  private async finish(tenantId: string, id: string) {
    await this.prisma.campaign.update({ where: { id }, data: { status: 'done', finishedAt: new Date() } }).catch(() => undefined);
    this.campaigns.emitProgress(tenantId, id, 'done');
    this.log.log(`Campanha ${id} concluída`);
  }
}
