import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ProviderRegistry } from './providers/provider.registry';
import { NumbersService } from './numbers.service';
import { ConversationsService } from '../conversations/conversations.service';
import { QUEUE_INBOUND, type InboundJob } from './queues';
import { StorageService } from '../../common/storage/storage.service';
import { FlowEngineService } from '../flows/flow-engine.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { enrichContext } from '../../common/observability/request-context';
import { isOptOut } from '../campaigns/dispatch';
import { PrismaService } from '../../common/prisma/prisma.service';
import { shouldRefreshAvatar } from './avatar-refresh';

@Processor(QUEUE_INBOUND, { concurrency: 10 })
export class InboundProcessor extends TrackedWorkerHost<InboundJob> {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly numbers: NumbersService,
    private readonly conversations: ConversationsService,
    private readonly storage: StorageService,
    private readonly flows: FlowEngineService,
    private readonly scheduling: SchedulingService,
    private readonly prisma: PrismaService,
  ) {
    super(QUEUE_INBOUND);
  }

  /** Baixa a foto do contato e guarda no nosso storage; a URL da CDN do WhatsApp expira. */
  private async refreshAvatar(number: { id: string; tenantId: string }, contactId: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { phone: true, avatarUrl: true, avatarCheckedAt: true },
    });
    if (!contact || !shouldRefreshAvatar(contact)) return;

    const ctx = await this.numbers.context(number.id);
    const provider = this.registry.get(ctx.provider);
    if (!provider.fetchProfilePicture) return; // API oficial não expõe foto de contato

    // marca a tentativa ANTES de buscar: se o provider estiver fora do ar, não queremos
    // repetir a chamada a cada mensagem que chegar
    await this.prisma.contact.update({ where: { id: contactId }, data: { avatarCheckedAt: new Date() } });

    const pic = await provider.fetchProfilePicture(ctx, contact.phone);
    if (!pic) return;

    const key = this.storage.makeKey(number.tenantId, pic.mimeType, pic.fileName);
    await this.storage.put(key, pic.data, pic.mimeType);
    await this.prisma.contact.update({ where: { id: contactId }, data: { avatarUrl: key } });
  }

  protected async handle(job: Job<InboundJob>) {
    const parsed = this.registry.get(job.data.provider).parseWebhook(job.data.body);

    for (const msg of parsed.messages) {
      const number = await this.numbers.findByExternal(job.data.provider, msg.externalNumberId);
      if (!number) {
        this.log.warn(`Mensagem para número desconhecido ${job.data.provider}:${msg.externalNumberId}`);
        continue;
      }
      enrichContext({ tenantId: number.tenantId }); // daqui para a frente o log sai com o tenant
      const result = await this.conversations.ingestInbound(number, msg);
      const saved = result?.message;
      // automação: avança fluxo ativo ou avalia gatilhos (nunca derruba a ingestão)
      if (result) {
        // "sair"/"parar": descadastra do disparo em massa. Vem antes da automação porque
        // responder com um fluxo a quem pediu para sair é o caminho curto para a denúncia.
        // Não encerra o atendimento: a pessoa pode voltar a escrever e precisa ser atendida.
        if (isOptOut(result.message.text)) {
          await this.prisma.contact.update({ where: { id: result.conversation.contactId }, data: { optOutAt: new Date() } })
            .then(() => this.log.log(`Contato ${result.conversation.contactId} pediu para não receber disparos`))
            .catch((err) => this.log.error(`descadastro: ${err instanceof Error ? err.message : err}`));
        }
        // "1"/"2" em resposta a lembrete de agendamento tem prioridade sobre fluxos
        const handled = await this.scheduling.onInbound(number.tenantId, result.conversation.contactId, result.conversation.id, result.message.text ?? '', msg.interactiveReplyId).catch((err) => { this.log.error(`agenda: ${err instanceof Error ? err.message : err}`); return false; });
        if (!handled) await this.flows.onInbound(number, result.conversation, result.message, result.isNew, { isNewContact: result.isNewContact, returningAfterClosed: result.returningAfterClosed, hoursSinceLastMessage: result.hoursSinceLastMessage }).catch((err) => this.log.error(`fluxo: ${err instanceof Error ? err.message : err}`));
      }
      // foto de perfil do contato: na primeira mensagem e depois só de tempos em tempos.
      // Nunca derruba a ingestão — é enfeite, a mensagem é o que importa.
      if (result) await this.refreshAvatar(number, result.conversation.contactId).catch((err) => this.log.debug(`foto: ${err instanceof Error ? err.message : err}`));

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
