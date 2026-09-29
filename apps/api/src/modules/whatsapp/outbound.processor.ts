import { Processor } from '@nestjs/bullmq';
import { DelayedError, UnrecoverableError } from 'bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProviderRegistry } from './providers/provider.registry';
import { NumbersService } from './numbers.service';
import { UsageService } from '../billing/usage.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { QUEUE_OUTBOUND, type OutboundJob } from './queues';
import type { OutboundMessage, MessageType } from '@atendo/shared';
import { StorageService } from '../../common/storage/storage.service';
import { ConversationsService } from '../conversations/conversations.service';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { enrichContext } from '../../common/observability/request-context';
import { SendPacer } from './send-pacer';

/** Envia mensagens já persistidas como `pending`. Retry com backoff fica a cargo do BullMQ. */
@Processor(QUEUE_OUTBOUND, { concurrency: 20 })
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
  ) {
    super(QUEUE_OUTBOUND);
  }

  protected async handle(job: Job<OutboundJob>, token?: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: job.data.messageId },
      include: { conversation: { include: { contact: true } } },
    });
    if (!message || message.status !== 'pending' || message.internal) return;
    enrichContext({ tenantId: message.conversation.tenantId });
    // Já foi entregue ao provider numa tentativa anterior (ex.: falhou só a contabilidade):
    // NUNCA reenviar — o cliente receberia em dobro. Só conserta o status.
    if (message.externalId) {
      const fixed = await this.prisma.message.update({ where: { id: message.id }, data: { status: 'sent', error: null } });
      this.gateway.emitMessage(ctxTenant(message), this.conversations.present(fixed));
      return;
    }

    const ctx = await this.numbers.context(message.conversation.numberId);
    const provider = this.registry.get(ctx.provider);

    // ---- proteção do número (bloqueio/banimento) ----
    const num = await this.prisma.whatsAppNumber.findUniqueOrThrow({
      where: { id: message.conversation.numberId },
      select: { id: true, sendDelay: true, sendDailyLimit: true, warmupStartedAt: true },
    });
    const day = await this.pacer.dailyStatus(num);
    if (!day.ok) {
      // teto do dia: não adianta tentar de novo hoje, então nada de retry
      this.log.warn(`Número ${num.id}: ${day.reason}`, { sent: day.sent, limit: day.limit });
      const blocked = await this.prisma.message.update({ where: { id: message.id }, data: { status: 'failed', error: day.reason } });
      this.gateway.emitMessage(ctx.tenantId, this.conversations.present(blocked));
      throw new UnrecoverableError(day.reason!);
    }
    // reserva a vaga uma única vez; nas reentradas o job já tem a dele
    if (!job.data.pacedUntil) {
      const wait = await this.pacer.reserve(num.id, num.sendDelay);
      if (wait > 0) {
        const until = Date.now() + wait;
        this.log.debug(`Envio ${message.id} adiado ${Math.round(wait / 1000)}s (perfil ${num.sendDelay})`);
        // devolve o job para a fila com atraso em vez de segurar o worker parado
        await job.updateData({ ...job.data, pacedUntil: until });
        await job.moveToDelayed(until, token);
        throw new DelayedError();
      }
    }
    const raw = (message.raw ?? {}) as { template?: OutboundMessage['template']; interactive?: OutboundMessage['interactive']; body?: string };

    const outbound: OutboundMessage = {
      to: message.conversation.contact.phone,
      type: message.type as MessageType,
      // interativo: o provider recebe o corpo original + opções (o texto numerado é só para o histórico)
      text: raw.interactive ? raw.body : (message.text ?? undefined),
      interactive: raw.interactive,
      media: message.mediaUrl ? { url: message.mediaUrl, mimeType: message.mediaMime ?? undefined, fileName: message.mediaName ?? undefined, caption: message.text ?? undefined } : undefined,
      quotedExternalId: message.quotedId ?? undefined,
      template: raw.template,
    };

    // mídia do nosso storage vai como binário; o provider decide como entregar (base64 / upload)
    const media = message.mediaUrl && !message.mediaUrl.startsWith('http')
      ? { ...(await this.storage.get(message.mediaUrl)), fileName: message.mediaName ?? undefined }
      : undefined;

    let result;
    try {
      result = await provider.send(ctx, outbound, media);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.log.error(`Falha ao enviar ${message.id}: ${error}`);
      // Sessão caiu por baixo ("Connection Closed"): reinicia a instância e deixa o retry do BullMQ tentar de novo
      if (/connection closed/i.test(error) && provider.restart) {
        this.log.warn(`Número ${ctx.numberId}: sessão zumbi, reiniciando instância`);
        await provider.restart(ctx);
      }
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        const failed = await this.prisma.message.update({ where: { id: message.id }, data: { status: 'failed', error } });
        this.gateway.emitMessage(ctx.tenantId, this.conversations.present(failed));
      }
      throw err;
    }

    // A partir daqui a mensagem JÁ FOI ENTREGUE. Erro de contabilidade não pode marcar falha
    // nem provocar retry (que reenviaria). Grava o externalId primeiro, o resto é best-effort.
    const updated = await this.prisma.message.update({
      where: { id: message.id },
      data: { status: result.status, externalId: result.externalId, error: null },
    });
    await this.pacer.countSend(num.id).catch(() => undefined);
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
  }
}

const ctxTenant = (m: { conversation: { tenantId: string } }) => m.conversation.tenantId;
