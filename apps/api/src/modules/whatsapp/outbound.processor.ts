import { InjectQueue, Processor } from '@nestjs/bullmq';
import { DelayedError, UnrecoverableError } from 'bullmq';
import type { Job, Queue } from 'bullmq';
import type { Message } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProviderRegistry } from './providers/provider.registry';
import { NumbersService } from './numbers.service';
import { UsageService } from '../billing/usage.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { QUEUE_OUTBOUND, type OutboundJob } from './queues';
import { resolveSendLimits, SEND_RETRY, type OutboundMessage, type MessageType, type SendLimits, type SendProvider } from '@atendo/shared';
import { StorageService } from '../../common/storage/storage.service';
import { ConversationsService } from '../conversations/conversations.service';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { enrichContext } from '../../common/observability/request-context';
import { SendPacer } from './send-pacer';
import { countsTowardDailyLimit } from './sending-policy';
import { isTransientSendError, retryDelayMs } from './providers/provider-error';
import { expiredReason, headOf, planSend, promoteNext } from './send-queue';

/**
 * Único lugar que entrega mensagens ao provider (docs/envio.md). Recebe mensagens já
 * persistidas como `pending` e, nesta ordem: confere a vez na conversa, pausa se o número
 * caiu, expira o que ficou tempo demais na fila, reserva o ritmo (número + conversa) e envia.
 * Retry só para erro transitório, com backoff exponencial e jitter (`send-jitter`).
 */
@Processor(QUEUE_OUTBOUND, {
  concurrency: 20,
  settings: { backoffStrategy: (attemptsMade: number) => retryDelayMs(attemptsMade, SEND_RETRY) },
})
export class OutboundProcessor extends TrackedWorkerHost<OutboundJob> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly numbers: NumbersService,
    private readonly usage: UsageService,
    private readonly gateway: ConversationsGateway,
    private readonly storage: StorageService,
    private readonly conversations: ConversationsService,
    private readonly pacer: SendPacer,
    @InjectQueue(QUEUE_OUTBOUND) private readonly outboundQueue: Queue<OutboundJob>,
  ) {
    super(QUEUE_OUTBOUND);
  }

  protected async handle(job: Job<OutboundJob>, token?: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: job.data.messageId },
      include: { conversation: { include: { contact: true } } },
    });
    // apagada antes de sair (docs/apagar-mensagens.md): o cancelamento grava `failed` junto; isto é a 2ª barreira
    if (!message || message.status !== 'pending' || message.internal || message.deletedAt) return;
    const tenantId = message.conversation.tenantId;
    enrichContext({ tenantId });
    // Já foi entregue ao provider numa tentativa anterior (ex.: falhou só a contabilidade):
    // NUNCA reenviar — o cliente receberia em dobro. Só conserta o status.
    if (message.externalId) {
      const fixed = await this.prisma.message.update({ where: { id: message.id }, data: { status: 'sent', error: null } });
      this.gateway.emitMessage(tenantId, this.conversations.present(fixed));
      return this.next(message.conversationId);
    }

    // sai pelo número gravado na mensagem (o validado no envio), nunca por outro;
    // mensagens anteriores à coluna caem no número da conversa
    const numberId = message.numberId ?? message.conversation.numberId;
    const num = await this.prisma.whatsAppNumber.findUniqueOrThrow({
      where: { id: numberId },
      select: { id: true, tenantId: true, provider: true, status: true, sendDelay: true, sendDailyLimit: true, warmupStartedAt: true, sendLimits: true },
    });
    if (num.tenantId !== tenantId) {
      const reason = 'Número de outro cliente — envio bloqueado';
      this.log.error(`${reason}: mensagem ${message.id}, número ${numberId}`);
      await this.fail(message, tenantId, reason);
      throw new UnrecoverableError(reason);
    }
    const limits = resolveSendLimits(num.provider as SendProvider, num.sendLimits as Partial<SendLimits> | null);

    // ---- vez na conversa, conexão e prazo ----
    const plan = planSend({
      now: Date.now(),
      message,
      head: await headOf(this.prisma, message.conversationId),
      numberStatus: num.status,
      maxQueueAgeMin: limits.maxQueueAgeMin,
    });
    switch (plan.action) {
      case 'skip':
        return;
      case 'expire':
        this.log.warn(`Envio ${message.id} expirou na fila (número ${num.id} ${num.status})`);
        await this.fail(message, tenantId, plan.reason);
        return this.next(message.conversationId);
      case 'wait_turn':
        if (plan.staleHead) {
          // a da frente ficou presa (ex.: job perdido): expira para não travar a conversa
          const stale = await this.prisma.message.updateMany({ where: { id: plan.staleHead, status: 'pending' }, data: { status: 'failed', error: expiredReason(limits.maxQueueAgeMin) } });
          if (stale.count) {
            const m = await this.prisma.message.findUnique({ where: { id: plan.staleHead } });
            if (m) this.gateway.emitMessage(tenantId, this.conversations.present(m));
          }
        }
        return this.later(job, token, Date.now() + plan.delayMs, job.data);
      case 'pause':
        // número desconectado: não insiste no provider. A vaga reservada é descartada — ao
        // reconectar, cada envio reserva de novo e sai no ritmo, não tudo de uma vez.
        this.log.debug(`Envio ${message.id} pausado: número ${num.id} ${num.status}`);
        return this.later(job, token, Date.now() + plan.delayMs, { messageId: job.data.messageId });
    }

    // ---- proteção do número (bloqueio/banimento) ----
    // teto do dia e aquecimento valem só para envio proativo; resposta de atendimento nunca trava
    const proativo = countsTowardDailyLimit(message.conversation.lastInboundAt);
    const day = proativo ? await this.pacer.dailyStatus(num) : { ok: true as const };
    if (!day.ok) {
      // teto do dia: não adianta tentar de novo hoje, então nada de retry
      this.log.warn(`Número ${num.id}: ${day.reason}`, { sent: day.sent, limit: day.limit });
      await this.fail(message, tenantId, day.reason!);
      await this.next(message.conversationId);
      throw new UnrecoverableError(day.reason!);
    }
    // reserva a vaga uma única vez; nas reentradas o job já tem a dele
    if (!job.data.pacedUntil) {
      const { waitMs, burst } = await this.pacer.reserve({ numberId: num.id, conversationId: message.conversationId, messageId: message.id, profile: num.sendDelay, limits });
      if (burst) this.log.warn(`Rajada na conversa ${message.conversationId}: envio ${message.id} adiado ${Math.round(waitMs / 1000)}s (limite ${limits.convBurstMax}/${limits.convBurstWindowSec}s)`);
      if (waitMs > 0) {
        const until = Date.now() + waitMs;
        this.log.debug(`Envio ${message.id} adiado ${Math.round(waitMs / 1000)}s (perfil ${num.sendDelay})`);
        // devolve o job para a fila com atraso em vez de segurar o worker parado
        return this.later(job, token, until, { ...job.data, pacedUntil: until });
      }
    }

    const ctx = await this.numbers.context(numberId);
    const provider = this.registry.get(ctx.provider);
    const raw = (message.raw ?? {}) as { template?: OutboundMessage['template']; interactive?: OutboundMessage['interactive']; body?: string; voice?: boolean };

    const outbound: OutboundMessage = {
      to: message.conversation.contact.phone,
      type: message.type as MessageType,
      // interativo: o provider recebe o corpo original + opções (o texto numerado é só para o histórico)
      text: raw.interactive ? raw.body : (message.text ?? undefined),
      interactive: raw.interactive,
      media: message.mediaUrl ? { url: message.mediaUrl, mimeType: message.mediaMime ?? undefined, fileName: message.mediaName ?? undefined, caption: message.text ?? undefined, voice: raw.voice } : undefined,
      quotedExternalId: message.quotedId ?? undefined,
      template: raw.template,
    };

    let result;
    try {
      // mídia do nosso storage vai como binário; o provider decide como entregar (base64 / upload)
      const media = message.mediaUrl && !message.mediaUrl.startsWith('http')
        ? { ...(await this.storage.get(message.mediaUrl)), fileName: message.mediaName ?? undefined }
        : undefined;
      result = await provider.send(ctx, outbound, media);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // Sessão caiu por baixo ("Connection Closed"): reinicia a instância e deixa o retry tentar de novo
      if (/connection closed/i.test(error) && provider.restart) {
        this.log.warn(`Número ${ctx.numberId}: sessão zumbi, reiniciando instância`);
        await provider.restart(ctx).catch(() => undefined);
      }
      const transient = isTransientSendError(err);
      const last = !transient || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (last) {
        await this.fail(message, tenantId, error);
        await this.next(message.conversationId);
        // permanente: falha na hora, sem gastar tentativas
        throw transient ? err : new UnrecoverableError(error);
      }
      this.log.warn(`Envio ${message.id}: erro transitório, nova tentativa (${job.attemptsMade + 1}/${job.opts.attempts}): ${error}`);
      // a nova tentativa reserva o ritmo de novo
      await job.updateData({ messageId: job.data.messageId });
      throw err;
    }

    // A partir daqui a mensagem JÁ FOI ENTREGUE. Erro de contabilidade não pode marcar falha
    // nem provocar retry (que reenviaria). Grava o externalId primeiro, o resto é best-effort.
    const updated = await this.prisma.message.update({
      where: { id: message.id },
      data: { status: result.status, externalId: result.externalId, error: null },
    });
    if (proativo) await this.pacer.countSend(num.id).catch(() => undefined);
    this.gateway.emitMessage(ctx.tenantId, this.conversations.present(updated));
    try {
      await this.usage.record({
        tenantId: ctx.tenantId,
        numberId: ctx.numberId,
        messageId: message.id,
        provider: ctx.provider,
        direction: 'out',
        billingCategory: result.billingCategory,
        contactId: message.conversation.contactId,
      });
    } catch (err) {
      this.log.error(`Uso não registrado para ${message.id} (mensagem foi entregue): ${err instanceof Error ? err.message : err}`);
    }
    await this.next(message.conversationId);
  }

  /** Devolve o job para a fila até `until` (não conta como tentativa). */
  private async later(job: Job<OutboundJob>, token: string | undefined, until: number, data: OutboundJob): Promise<never> {
    await job.updateData(data);
    await job.moveToDelayed(until, token);
    throw new DelayedError();
  }

  private async fail(message: Message, tenantId: string, error: string) {
    const failed = await this.prisma.message.update({ where: { id: message.id }, data: { status: 'failed', error } });
    this.gateway.emitMessage(tenantId, this.conversations.present(failed));
  }

  /** Chama a próxima da conversa. Falhar aqui só atrasa (ela se reavalia sozinha). */
  private async next(conversationId: string) {
    await promoteNext(this.prisma, this.outboundQueue, conversationId).catch((err) => this.log.warn(`promoção da fila falhou: ${err instanceof Error ? err.message : err}`));
  }
}
