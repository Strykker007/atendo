import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ProviderRegistry } from './providers/provider.registry';
import type { MediaPayload } from './providers/provider.interface';
import { NumbersService } from './numbers.service';
import { ConversationsService } from '../conversations/conversations.service';
import { InboundService } from '../conversations/inbound.service';
import { QUEUE_INBOUND, type InboundJob } from './queues';
import { StorageService } from '../../common/storage/storage.service';
import { FlowEngineService } from '../flows/flow-engine.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { enrichContext } from '../../common/observability/request-context';
import { isAmbiguousOptOut, isOptOut } from '../campaigns/dispatch';
import { PrismaService } from '../../common/prisma/prisma.service';
import { shouldRefreshAvatar } from './avatar-refresh';

@Processor(QUEUE_INBOUND, { concurrency: 10 })
export class InboundProcessor extends TrackedWorkerHost<InboundJob> {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly numbers: NumbersService,
    private readonly conversations: ConversationsService,
    private readonly inbound: InboundService,
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
      const result = await this.inbound.ingestInbound(number, msg);
      const saved = result?.message;
      // automação: avança fluxo ativo ou avalia gatilhos (nunca derruba a ingestão)
      // o que o cliente digitou no celular dele entra no histórico, mas não aciona nada:
      // responder com um fluxo ao dono do número seria o robô conversando com o chefe
      if (result && !result.fromMe) {
        // "sair"/"parar": descadastra de TODO envio automático (campanha, fluxo, boas-vindas,
        // lembrete). Vem antes da automação porque responder com um fluxo a quem pediu para sair
        // é o caminho curto para a denúncia. Não encerra o atendimento: a pessoa pode voltar a
        // escrever e precisa ser atendida por gente.
        if (isOptOut(result.message.text) && !(isAmbiguousOptOut(result.message.text) && (await this.awaitingAnswer(result.conversation.id, result.conversation.contactId)))) {
          await this.prisma.contact.update({ where: { id: result.conversation.contactId }, data: { optOutAt: new Date() } })
            .then(() => this.log.log(`Contato ${result.conversation.contactId} pediu para não receber mensagens automáticas`))
            .catch((err) => this.log.error(`descadastro: ${err instanceof Error ? err.message : err}`));
        }
        // descadastrado (agora ou antes): nada de robô — a conversa fica para o atendente
        const ficha = await this.prisma.contact.findUnique({ where: { id: result.conversation.contactId }, select: { optOutAt: true, waInvalidAt: true } });
        const descadastrado = !!ficha?.optOutAt;
        // escreveu, então tem WhatsApp: a marca da checagem antiga não vale mais
        if (ficha?.waInvalidAt) await this.prisma.contact.update({ where: { id: result.conversation.contactId }, data: { waInvalidAt: null } }).catch(() => undefined);
        // "1"/"2" em resposta a lembrete de agendamento tem prioridade sobre fluxos
        const handled = descadastrado || await this.scheduling.onInbound(number.tenantId, result.conversation.contactId, result.conversation.id, result.message.text ?? '', msg.interactiveReplyId).catch((err) => { this.log.error(`agenda: ${err instanceof Error ? err.message : err}`); return false; });
        if (!handled) await this.flows.onInbound(number, result.conversation, result.message, result.isNew, { isNewContact: result.isNewContact, returningAfterClosed: result.returningAfterClosed, hoursSinceLastMessage: result.hoursSinceLastMessage }).catch((err) => this.log.error(`fluxo: ${err instanceof Error ? err.message : err}`));
      }
      // foto de perfil do contato: na primeira mensagem e depois só de tempos em tempos.
      // Nunca derruba a ingestão — é enfeite, a mensagem é o que importa.
      if (result) await this.refreshAvatar(number, result.conversation.contactId).catch((err) => this.log.debug(`foto: ${err instanceof Error ? err.message : err}`));
      // conversa começada pelo celular do cliente: o contato nasce sem nome (o pushName era o
      // do dono do número); pergunta ao provider. Também é enfeite — não derruba nada.
      // (fillMissingName só consulta o provider se o contato continuar sem nome)
      if (result?.fromMe) {
        const provider = this.registry.get(job.data.provider);
        if (provider.contactName) {
          const ctx = await this.numbers.context(number.id);
          await this.inbound.fillMissingName(number, result.conversation.contactId, (phone) => provider.contactName!(ctx, phone))
            .catch((err) => this.log.debug(`nome do contato: ${err instanceof Error ? err.message : err}`));
        }
      }

      // mídia: baixa do provider e guarda no storage privado (falha aqui não perde a mensagem)
      if (saved && msg.media) {
        try {
          const ctx = await this.numbers.context(number.id);
          const media = await this.registry.get(job.data.provider).fetchMedia(ctx, msg);
          if (media) {
            const key = this.storage.makeKey(number.tenantId, media.mimeType, media.fileName);
            await this.storage.put(key, media.data, media.mimeType);
            await this.inbound.attachMedia(saved.id, number.tenantId, key, media.mimeType, media.fileName);
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.log.warn(`Mídia de ${msg.externalId} não baixada: ${reason}`);
          await this.inbound.mediaFailed(saved.id, number.tenantId, reason);
        }
      }

      // resposta a status com foto/vídeo: guarda a mídia do status, que some em 24h. Sem a
      // mídia inteira, fica a miniatura do payload. Falha aqui só tira o preview, nunca a mensagem
      if (saved && msg.quotedFromStatus && msg.quotedMedia) {
        const provider = this.registry.get(job.data.provider);
        let media: MediaPayload | null = null;
        try {
          if (provider.fetchQuotedMedia) media = await provider.fetchQuotedMedia(await this.numbers.context(number.id), msg);
        } catch (err) {
          this.log.debug(`mídia do status citado em ${msg.externalId}: ${err instanceof Error ? err.message : err}`);
        }
        if (!media && msg.quotedMedia.thumbnail) media = { data: Buffer.from(msg.quotedMedia.thumbnail, 'base64'), mimeType: 'image/jpeg' };
        try {
          if (!media) throw new Error('sem mídia nem miniatura');
          const key = this.storage.makeKey(number.tenantId, media.mimeType);
          await this.storage.put(key, media.data, media.mimeType);
          await this.inbound.attachQuotedMedia(saved.id, number.tenantId, key, media.mimeType);
        } catch (err) {
          this.log.warn(`status citado de ${msg.externalId}: ${err instanceof Error ? err.message : err}`);
          await this.inbound.quotedMediaFailed(saved.id, number.tenantId).catch(() => undefined);
        }
      }
    }

    for (const st of parsed.statuses) await this.inbound.applyStatus(st);

    for (const r of parsed.reactions) {
      const number = await this.numbers.findByExternal(job.data.provider, r.externalNumberId);
      if (number) await this.inbound.applyReaction(number, r);
    }

    for (const e of parsed.edits ?? []) {
      const number = await this.numbers.findByExternal(job.data.provider, e.externalNumberId);
      if (number) await this.inbound.applyEdit(number, e);
    }

    for (const c of parsed.contactNames ?? []) {
      const number = await this.numbers.findByExternal(job.data.provider, c.externalNumberId);
      if (number) await this.inbound.applyContactName(number, c);
    }

    for (const p of parsed.presences ?? []) {
      const number = await this.numbers.findByExternal(job.data.provider, p.externalNumberId);
      if (number) await this.inbound.applyPresence(number, p);
    }

    if (parsed.connection) {
      const number = await this.numbers.findByExternal(job.data.provider, parsed.connection.externalNumberId);
      if (number) await this.inbound.numberConnectionChanged(number, parsed.connection);
    }
  }

  /**
   * "cancelar" é resposta, não descadastro, quando há um fluxo esperando resposta ou um
   * agendamento futuro (o robô de agenda aceita "cancelar"). Sem isto, quem cancelava um horário
   * parava de receber lembretes para sempre.
   */
  private async awaitingAnswer(conversationId: string, contactId: string) {
    const [run, appt] = await Promise.all([
      this.prisma.flowRun.findFirst({ where: { conversationId, status: { in: ['running', 'waiting'] } }, select: { id: true } }),
      this.prisma.appointment.findFirst({ where: { contactId, startAt: { gt: new Date() }, status: { in: ['scheduled', 'confirmed'] } }, select: { id: true } }),
    ]);
    return !!run || !!appt;
  }
}
