import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProviderRegistry } from './providers/provider.registry';
import { NumbersService } from './numbers.service';
import { UsageService } from '../billing/usage.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { QUEUE_OUTBOUND, type OutboundJob } from './queues';
import type { OutboundMessage, MessageType } from '@atendo/shared';

/** Envia mensagens já persistidas como `pending`. Retry com backoff fica a cargo do BullMQ. */
@Processor(QUEUE_OUTBOUND, { concurrency: 20 })
export class OutboundProcessor extends WorkerHost {
  private readonly log = new Logger(OutboundProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly numbers: NumbersService,
    private readonly usage: UsageService,
    private readonly gateway: ConversationsGateway,
  ) {
    super();
  }

  async process(job: Job<OutboundJob>) {
    const message = await this.prisma.message.findUnique({
      where: { id: job.data.messageId },
      include: { conversation: { include: { contact: true } } },
    });
    if (!message || message.status !== 'pending') return;

    const ctx = await this.numbers.context(message.conversation.numberId);
    const provider = this.registry.get(ctx.provider);
    const raw = (message.raw ?? {}) as { template?: OutboundMessage['template'] };

    const outbound: OutboundMessage = {
      to: message.conversation.contact.phone,
      type: message.type as MessageType,
      text: message.text ?? undefined,
      media: message.mediaUrl ? { url: message.mediaUrl, mimeType: message.mediaMime ?? undefined, fileName: message.mediaName ?? undefined } : undefined,
      quotedExternalId: message.quotedId ?? undefined,
      template: raw.template,
    };

    try {
      const result = await provider.send(ctx, outbound);
      const updated = await this.prisma.message.update({
        where: { id: message.id },
        data: { status: result.status, externalId: result.externalId },
      });
      await this.usage.record({
        tenantId: ctx.tenantId,
        numberId: ctx.numberId,
        messageId: message.id,
        provider: ctx.provider,
        direction: 'out',
        billingCategory: result.billingCategory,
      });
      this.gateway.emitMessage(ctx.tenantId, updated);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.log.error(`Falha ao enviar ${message.id}: ${error}`);
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        const failed = await this.prisma.message.update({ where: { id: message.id }, data: { status: 'failed', error } });
        this.gateway.emitMessage(ctx.tenantId, failed);
      }
      throw err;
    }
  }
}
