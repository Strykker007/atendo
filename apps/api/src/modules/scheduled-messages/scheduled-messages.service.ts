import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';

/** Antecedência mínima: menos que isso é "enviar agora". */
export const SCHEDULE_MIN_AHEAD_MS = 60_000;
/** Até quando dá para agendar. */
export const SCHEDULE_MAX_AHEAD_DAYS = 365;
/** Quantas vencidas cada rodada do job envia (o resto fica para o minuto seguinte). */
const BATCH = 100;
const META_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ScheduledMediaType = 'image' | 'audio' | 'video' | 'document';

export interface ScheduleInput {
  content: string;
  scheduledFor: Date;
  mediaKey?: string;
  mediaType?: ScheduledMediaType;
  mediaName?: string;
  mediaMime?: string;
}

const USER_SELECT = { user: { select: { id: true, name: true } } } as const;

/**
 * Mensagens agendadas pelo atendente (docs/agendamento-de-mensagens.md).
 *
 * Na hora, a mensagem sai pelo MESMO caminho do chat (`ConversationsService.send`), como se
 * quem agendou tivesse apertado Enviar: quota, janela da Meta, "responder = assumir",
 * variáveis e ledger valem igual. O que não puder sair vira `failed` com o motivo — nunca
 * some em silêncio.
 */
@Injectable()
export class ScheduledMessagesService {
  private readonly logger = new Logger(ScheduledMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly gateway: ConversationsGateway,
  ) {}

  /** Pendentes e as que falharam (para a pessoa ver o motivo), da mais próxima para a mais distante. */
  list(tenantId: string, conversationId: string) {
    return this.prisma.scheduledMessage.findMany({
      where: { tenantId, conversationId, status: { in: ['pending', 'failed'] } },
      orderBy: { scheduledFor: 'asc' },
      include: USER_SELECT,
      take: 100,
    });
  }

  async create(tenantId: string, userId: string, conversationId: string, input: ScheduleInput) {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId }, include: { number: true } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const content = input.content.trim();
    if (!content && !input.mediaKey) throw new BadRequestException('Escreva a mensagem ou anexe um arquivo');
    if (input.mediaKey && !input.mediaKey.startsWith(`media/${tenantId}/`)) throw new BadRequestException('mediaKey inválida');
    if (input.mediaKey && !input.mediaType) throw new BadRequestException('Informe o tipo do anexo');

    const when = input.scheduledFor.getTime();
    if (Number.isNaN(when)) throw new BadRequestException('Data inválida');
    if (when < Date.now() + SCHEDULE_MIN_AHEAD_MS) throw new BadRequestException('Escolha um horário pelo menos 1 minuto à frente');
    if (when > Date.now() + SCHEDULE_MAX_AHEAD_DAYS * 86_400_000) throw new BadRequestException(`Dá para agendar até ${SCHEDULE_MAX_AHEAD_DAYS} dias à frente`);

    // mesma regra do envio: conversa de outra pessoa não recebe mensagem em nome dela
    if (conv.assigneeId && conv.assigneeId !== userId) {
      throw new ConflictException('Outra pessoa está atendendo esta conversa. Transfira para você antes de agendar.');
    }
    // Meta: fora da janela de 24h só template — e agendamento de template não existe ainda
    if (conv.number.provider === 'meta') {
      const fim = conv.lastInboundAt ? conv.lastInboundAt.getTime() + META_WINDOW_MS : 0;
      if (when >= fim) {
        const ate = await this.formatWhen(tenantId, new Date(fim));
        throw new BadRequestException(fim > Date.now()
          ? `Neste número (API oficial) só dá para mandar mensagem livre até ${ate} — 24h depois da última mensagem do cliente.`
          : 'Janela de 24h da Meta expirou: neste número só sai template aprovado.');
      }
    }

    const row = await this.prisma.scheduledMessage.create({
      data: {
        tenantId,
        conversationId,
        contactId: conv.contactId,
        userId,
        content,
        mediaKey: input.mediaKey,
        mediaType: input.mediaType,
        mediaName: input.mediaName,
        mediaMime: input.mediaMime,
        scheduledFor: input.scheduledFor,
      },
      include: USER_SELECT,
    });
    this.gateway.emitScheduledMessages(tenantId, conversationId);
    return row;
  }

  /** Cancela uma pendente; falhada é só dispensada da lista (mesmo status final). */
  async cancel(tenantId: string, userId: string, conversationId: string, id: string) {
    const r = await this.prisma.scheduledMessage.updateMany({
      where: { id, tenantId, conversationId, status: { in: ['pending', 'failed'] } },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: userId },
    });
    if (r.count === 0) throw new NotFoundException('Agendamento não encontrado ou já enviado');
    this.gateway.emitScheduledMessages(tenantId, conversationId);
    return { ok: true };
  }

  /** "21/10 09:00" no fuso do cliente. */
  private async formatWhen(tenantId: string, date: Date) {
    const tz = (await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } }))?.timezone || 'America/Sao_Paulo';
    return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).replace(',', '');
  }

  /** Job de 1 minuto: envia as vencidas. */
  async runDue(now = new Date()) {
    const due = await this.prisma.scheduledMessage.findMany({
      where: { status: 'pending', scheduledFor: { lte: now } },
      orderBy: { scheduledFor: 'asc' },
      take: BATCH,
    });
    for (const s of due) await this.dispatch(s.id);
    return due.length;
  }

  private async dispatch(id: string) {
    // reler: pode ter sido cancelada entre a busca e agora
    const s = await this.prisma.scheduledMessage.findUnique({ where: { id }, include: { conversation: { select: { status: true } } } });
    if (!s || s.status !== 'pending') return;
    try {
      // conversa encerrada: quem agendou está "voltando a falar" com o cliente — reabre com ele
      if (s.conversation.status === 'closed') await this.conversations.setStatus(s.tenantId, s.conversationId, 'in_progress', s.userId);
      const media = s.mediaKey && s.mediaType ? (s.mediaType as ScheduledMediaType) : null;
      const message = await this.conversations.send(s.tenantId, { id: s.userId, role: 'agent' }, s.conversationId, {
        type: media ?? 'text',
        text: s.content || undefined,
        ...(media && { mediaKey: s.mediaKey!, media: { url: s.mediaKey!, mimeType: s.mediaMime ?? undefined, fileName: s.mediaName ?? undefined } }),
        // job repetido (worker reiniciou no meio) não manda duas vezes
        idempotencyKey: `scheduled-${s.id}`,
        // sai sozinha no horário, sem ninguém digitando: "digitando…" simulado pelo tamanho do texto
        simulateTypingChars: (s.content ?? '').length,
      });
      await this.prisma.scheduledMessage.update({ where: { id }, data: { status: 'sent', sentAt: new Date(), messageId: message.id, error: null } });
    } catch (err) {
      this.logger.warn(`agendada ${id} não saiu: ${err instanceof Error ? err.message : String(err)}`);
      // regra de envio (HttpException) já vem em português para quem atende; erro técnico não
      const error = err instanceof HttpException ? err.message : 'Erro inesperado no envio. Envie a mensagem manualmente.';
      await this.prisma.scheduledMessage.update({ where: { id }, data: { status: 'failed', error: error.slice(0, 500) } });
      // nota interna: quem abrir a conversa vê o motivo no histórico, não só na faixa
      const quando = await this.formatWhen(s.tenantId, s.scheduledFor);
      await this.conversations.systemNote(s.conversationId, `⏰ A mensagem agendada para ${quando} não foi enviada: ${error}`).catch(() => undefined);
    }
    this.gateway.emitScheduledMessages(s.tenantId, s.conversationId);
  }
}
