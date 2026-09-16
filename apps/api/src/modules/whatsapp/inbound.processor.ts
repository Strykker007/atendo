import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ProviderRegistry } from './providers/provider.registry';
import { NumbersService } from './numbers.service';
import { ConversationsService } from '../conversations/conversations.service';
import { QUEUE_INBOUND, type InboundJob } from './queues';

@Processor(QUEUE_INBOUND, { concurrency: 10 })
export class InboundProcessor extends WorkerHost {
  private readonly log = new Logger(InboundProcessor.name);

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly numbers: NumbersService,
    private readonly conversations: ConversationsService,
  ) {
    super();
  }

  async process(job: Job<InboundJob>) {
    const parsed = this.registry.get(job.data.provider).parseWebhook(job.data.body);

    for (const msg of parsed.messages) {
      const number = await this.numbers.findByExternal(job.data.provider, msg.externalNumberId);
      if (!number) {
        this.log.warn(`Mensagem para número desconhecido ${job.data.provider}:${msg.externalNumberId}`);
        continue;
      }
      await this.conversations.ingestInbound(number, msg);
    }

    for (const st of parsed.statuses) await this.conversations.applyStatus(st);

    if (parsed.connection) {
      const number = await this.numbers.findByExternal(job.data.provider, parsed.connection.externalNumberId);
      if (number) await this.conversations.numberConnectionChanged(number, parsed.connection);
    }
  }
}
