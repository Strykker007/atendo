import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ProviderRegistry } from './providers/provider.registry';
import { NumbersService } from './numbers.service';
import { ConversationsService } from '../conversations/conversations.service';
import { QUEUE_INBOUND, type InboundJob } from './queues';
import { StorageService } from '../../common/storage/storage.service';
import { FlowEngineService } from '../flows/flow-engine.service';

@Processor(QUEUE_INBOUND, { concurrency: 10 })
export class InboundProcessor extends WorkerHost {
  private readonly log = new Logger(InboundProcessor.name);

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly numbers: NumbersService,
    private readonly conversations: ConversationsService,
    private readonly storage: StorageService,
    private readonly flows: FlowEngineService,
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
      const result = await this.conversations.ingestInbound(number, msg);
      const saved = result?.message;
      // automação: avança fluxo ativo ou avalia gatilhos (nunca derruba a ingestão)
      if (result) {
        await this.flows.onInbound(number, result.conversation, result.message, result.isNew).catch((err) => this.log.error(`fluxo: ${err instanceof Error ? err.message : err}`));
      }
      // mídia: baixa do provider e guarda no storage privado (falha aqui não perde a mensagem)
      if (saved && msg.media) {
        try {
          const ctx = await this.numbers.context(number.id);
          const media = await this.registry.get(job.data.provider).fetchMedia(ctx, msg);
          if (media) {
            const key = this.storage.makeKey(number.tenantId, media.mimeType, media.fileName);
            await this.storage.put(key, media.data, media.mimeType);
            await this.conversations.attachMedia(saved.id, number.tenantId, key, media.mimeType, media.fileName);
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.log.warn(`Mídia de ${msg.externalId} não baixada: ${reason}`);
          await this.conversations.mediaFailed(saved.id, number.tenantId, reason);
        }
      }
    }

    for (const st of parsed.statuses) await this.conversations.applyStatus(st);

    if (parsed.connection) {
      const number = await this.numbers.findByExternal(job.data.provider, parsed.connection.externalNumberId);
      if (number) await this.conversations.numberConnectionChanged(number, parsed.connection);
    }
  }
}
