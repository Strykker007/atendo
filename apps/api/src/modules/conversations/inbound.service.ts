import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Conversation, Message, WhatsAppNumber } from '@prisma/client';
import type { InboundMessage, StatusUpdate, NumberStatus } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsageService } from '../billing/usage.service';
import { ConversationsGateway } from './conversations.gateway';
import { ConversationsService, MESSAGE_INCLUDE, inicioDaEspera } from './conversations.service';
import { decidirEntrada, voltandoDepoisDeEncerrado } from './reopen';

/**
 * Tudo que **entra** pelo provider: mensagem recebida, mensagem digitada no celular, confirmação
 * de entrega e mudança de conexão do número.
 *
 * Saiu de `ConversationsService` quando aquele arquivo passou de 800 linhas misturando entrada,
 * saída, atendimento e ficha. A divisão não é por tipo de arquivo: é pelo caminho que o dado
 * percorre. Aqui é o lado de fora falando com a gente, e é o único lugar que lida com payload
 * de provider — o resto do sistema só conhece conversa e mensagem.
 *
 * Depende de `ConversationsService` (e não o contrário): quem recebe precisa reabrir conversa e
 * apresentar mensagem; quem atende nunca precisa saber de webhook.
 */
@Injectable()
export class InboundService {
  private readonly log = new Logger(InboundService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly gateway: ConversationsGateway,
    private readonly conversations: ConversationsService,
  ) {}

  /** Download da mídia falhou de vez: registra para a UI não ficar em "carregando". */
  async mediaFailed(messageId: string, tenantId: string, reason: string) {
    const m = await this.prisma.message.update({ where: { id: messageId }, data: { error: `Mídia indisponível: ${reason}`.slice(0, 200) }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(tenantId, this.conversations.present(m));
  }

  /** Chamado pelo worker depois de baixar a mídia recebida. */
  async attachMedia(messageId: string, tenantId: string, key: string, mimeType: string, fileName?: string) {
    const m = await this.prisma.message.update({ where: { id: messageId }, data: { mediaUrl: key, mediaMime: mimeType, mediaName: fileName }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(tenantId, this.conversations.present(m));
  }

  // ---------- inbound (worker) ----------

  async ingestInbound(number: WhatsAppNumber, msg: InboundMessage): Promise<{ message: Message; conversation: Conversation; isNew: boolean; isNewContact: boolean; returningAfterClosed: boolean; hoursSinceLastMessage: number | null; fromMe?: boolean } | null> {
    // idempotência: o mesmo webhook pode chegar duas vezes. É também o que descarta o eco do
    // que o PAINEL enviou: aquela mensagem já está no banco com este externalId.
    const exists = await this.prisma.message.findUnique({ where: { externalId: msg.externalId } });
    if (exists) return null;

    // digitada no celular do cliente, não no painel: entra como enviada
    if (msg.fromMe) return this.ingestFromDevice(number, msg);

    const contact = await this.prisma.contact.upsert({
      where: { tenantId_phone: { tenantId: number.tenantId, phone: msg.from } },
      create: { tenantId: number.tenantId, phone: msg.from, name: msg.contactName },
      update: msg.contactName ? { name: msg.contactName } : {},
    });

    // A conversa com esta pessoa neste número é UMA só, encerrada ou não (ver reopen.ts).
    // Encerrada, ela volta para a fila; o que começa de novo é o atendimento, não a conversa.
    let conversation = await this.prisma.conversation.findFirst({
      where: { numberId: number.id, contactId: contact.id },
      orderBy: { lastMessageAt: 'desc' },
    });
    const origin = this.originOf(msg.referral);
    // contexto para os fluxos padrão do cliente: é a primeira vez desta pessoa, ou ela
    // está voltando depois de um atendimento encerrado?
    const anterior = await this.prisma.conversation.findFirst({
      where: { tenantId: number.tenantId, contactId: contact.id },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true, status: true, lastMessageAt: true },
    });
    const isNewContact = !anterior;
    const decisao = decidirEntrada(conversation ? { id: conversation.id, status: conversation.status } : null);
    const returningAfterClosed = voltandoDepoisDeEncerrado(decisao, anterior?.status);
    const hoursSinceLastMessage = anterior?.lastMessageAt
      ? (msg.timestamp.getTime() - anterior.lastMessageAt.getTime()) / 3_600_000
      : null;
    if (decisao.acao === 'reabrir') {
      // atendimento novo na mesma conversa: volta para a fila, sem dono e sem o desfecho do
      // atendimento anterior — aquele já está congelado no histórico (conversation_events)
      conversation = await this.conversations.setStatusSystem(conversation!.id, 'waiting');
    }
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { tenantId: number.tenantId, numberId: number.id, contactId: contact.id, status: 'waiting', origin, originData: msg.referral ? (msg.referral as unknown as Prisma.InputJsonValue) : undefined },
      });
      if (origin === 'ad') await this.autoTagAd(conversation.id, number.tenantId, msg.referral?.headline);
    } else if (msg.referral && conversation.origin === 'organic') {
      // referral pode chegar numa mensagem posterior (contato clicou no anúncio já com conversa aberta)
      conversation = await this.prisma.conversation.update({ where: { id: conversation.id }, data: { origin, originData: msg.referral as unknown as Prisma.InputJsonValue } });
      if (origin === 'ad') await this.autoTagAd(conversation.id, number.tenantId, msg.referral?.headline);
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'in',
        type: msg.type,
        status: 'delivered',
        text: msg.text,
        mediaMime: msg.media?.mimeType,
        mediaName: msg.media?.fileName,
        externalId: msg.externalId,
        quotedId: msg.quotedExternalId,
        quotedMessageId: await this.resolveQuoted(number.tenantId, msg.quotedExternalId),
        quotedPreview: msg.quotedPreview,
        quotedFromStatus: msg.quotedFromStatus ?? false,
        // guarda o payload do provider + o id da opção já traduzido: é assim que o motor de
        // fluxos e os lembretes sabem em qual botão o contato tocou, sem conhecer Meta/Evolution
        raw: { ...(msg.raw as object), ...(msg.interactiveReplyId ? { interactiveReplyId: msg.interactiveReplyId } : {}) } as Prisma.InputJsonValue,
        createdAt: msg.timestamp,
      },
      include: MESSAGE_INCLUDE,
    });

    conversation = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastInboundAt: msg.timestamp,
        lastMessageAt: msg.timestamp,
        awaitingSince: inicioDaEspera(conversation.awaitingSince, msg.timestamp),
        lastMessagePreview: (msg.text ?? `[${msg.type}]`).slice(0, 120),
        unreadCount: { increment: 1 },
      },
    });

    await this.usage.record({
      tenantId: number.tenantId,
      numberId: number.id,
      messageId: message.id,
      provider: number.provider,
      direction: 'in',
      billingCategory: number.provider === 'meta' ? 'service' : 'unofficial',
      contactId: contact.id,
    });

    this.gateway.emitMessage(number.tenantId, this.conversations.present(message));
    this.gateway.emitConversation(number.tenantId, conversation);
    return { message, conversation, isNew: decisao.acao === 'criar', isNewContact, returningAfterClosed, hoursSinceLastMessage };
  }

  /**
   * Mensagem que o cliente mandou pelo CELULAR dele, não pelo painel.
   *
   * O WhatsApp entrega o mesmo evento das recebidas, só que marcado. Ignorá-las — como era
   * feito — deixava o painel com metade da conversa: aparecia o que o contato escreveu e
   * sumia o que o cliente respondeu do aparelho.
   *
   * Entra como mensagem enviada, sem autor (ninguém a escreveu no painel), e **sem acionar
   * automação**: disparar um fluxo por causa de algo que o próprio cliente escreveu seria o
   * robô respondendo ao dono do número.
   */
  private async ingestFromDevice(number: WhatsAppNumber, msg: InboundMessage) {
    const contact = await this.prisma.contact.upsert({
      where: { tenantId_phone: { tenantId: number.tenantId, phone: msg.from } },
      create: { tenantId: number.tenantId, phone: msg.from, name: msg.contactName },
      update: {},
    });

    // mesma regra da entrada: uma conversa por pessoa neste número (ver reopen.ts)
    let conversation = await this.prisma.conversation.findFirst({
      where: { numberId: number.id, contactId: contact.id },
      orderBy: { lastMessageAt: 'desc' },
    });
    // conversa iniciada do celular: precisa existir no painel, senão a resposta do contato
    // abriria outra e o histórico nasceria partido
    const isNew = !conversation;
    // falar com alguém cujo atendimento estava encerrado começa outro atendimento — e quem
    // está atendendo é quem escreveu do celular, então vai direto para "em atendimento"
    if (conversation?.status === 'closed') conversation = await this.conversations.setStatusSystem(conversation.id, 'in_progress');
    conversation ??= await this.prisma.conversation.create({
      data: { tenantId: number.tenantId, numberId: number.id, contactId: contact.id, status: 'in_progress' },
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'out',
        type: msg.type,
        status: 'sent',
        text: msg.text,
        mediaMime: msg.media?.mimeType,
        mediaName: msg.media?.fileName,
        externalId: msg.externalId,
        quotedId: msg.quotedExternalId,
        quotedMessageId: await this.resolveQuoted(number.tenantId, msg.quotedExternalId),
        quotedPreview: msg.quotedPreview,
        quotedFromStatus: msg.quotedFromStatus ?? false,
        raw: msg.raw as Prisma.InputJsonValue,
        createdAt: msg.timestamp,
      },
      include: MESSAGE_INCLUDE,
    });

    // nada de lastInboundAt nem de não-lidas: quem falou foi o cliente, não o contato.
    // Mexer em lastInboundAt ainda reabriria a janela de 24h da Meta sem o contato ter escrito.
    conversation = await this.prisma.conversation.update({
      where: { id: conversation.id },
      // respondeu pelo celular também é resposta: a espera acabou
      data: { lastMessageAt: msg.timestamp, lastMessagePreview: (msg.text ?? `[${msg.type}]`).slice(0, 120), awaitingSince: null },
    });

    await this.usage.record({
      tenantId: number.tenantId,
      numberId: number.id,
      messageId: message.id,
      provider: number.provider,
      direction: 'out',
      billingCategory: number.provider === 'meta' ? 'service' : 'unofficial',
      contactId: contact.id,
    });

    this.gateway.emitMessage(number.tenantId, this.conversations.present(message));
    this.gateway.emitConversation(number.tenantId, conversation);
    return { message, conversation, isNew, isNewContact: false, returningAfterClosed: false, hoursSinceLastMessage: null, fromMe: true };
  }

  /**
   * A citada pode não estar no banco (status/story, mensagem anterior à integração): aí fica só
   * o `quotedId`. Filtra pelo tenant porque `externalId` é único global, mas o dado não é de todos.
   */
  private async resolveQuoted(tenantId: string, quotedExternalId?: string): Promise<string | null> {
    if (!quotedExternalId) return null;
    const q = await this.prisma.message.findFirst({ where: { externalId: quotedExternalId, conversation: { tenantId } }, select: { id: true } });
    return q?.id ?? null;
  }

  private originOf(r?: InboundMessage['referral']) {
    if (!r) return 'organic' as const;
    if (r.sourceType === 'ad') return 'ad' as const;
    if (r.sourceType === 'post') return 'post' as const;
    return 'link' as const;
  }

  /**
   * Lead de anúncio ganha a tag "Anúncio" automaticamente (criada por tenant se não existir),
   * e uma tag com o título do anúncio quando houver — assim "leads por campanha" sai direto do filtro/relatório.
   */
  private async autoTagAd(conversationId: string, tenantId: string, headline?: string) {
    const names = ['Anúncio', ...(headline ? [`Anúncio: ${headline.slice(0, 32)}`] : [])];
    for (const name of names) {
      const tag = await this.prisma.tag.upsert({ where: { tenantId_name: { tenantId, name } }, create: { tenantId, name, color: '#f97316' }, update: {} });
      await this.prisma.conversationTag.upsert({ where: { conversationId_tagId: { conversationId, tagId: tag.id } }, create: { conversationId, tagId: tag.id }, update: {} });
    }
  }

  async applyStatus(st: StatusUpdate) {
    const m = await this.prisma.message.findUnique({ where: { externalId: st.externalId }, include: { conversation: { select: { tenantId: true } } } });
    if (!m) return;
    const order = ['pending', 'sent', 'delivered', 'read', 'failed'];
    if (order.indexOf(st.status) <= order.indexOf(m.status) && st.status !== 'failed') return; // não regride
    if (st.status === 'failed' && (m.status === 'delivered' || m.status === 'read')) return; // já chegou: erro tardio é ruído
    const updated = await this.prisma.message.update({ where: { id: m.id }, data: { status: st.status, error: st.error }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(m.conversation.tenantId, this.conversations.present(updated));
  }

  async numberConnectionChanged(number: WhatsAppNumber, c: { status: NumberStatus; qrCode?: string; phone?: string; transient?: boolean; loggedOut?: boolean }) {
    // Logo após parear, o WhatsApp reinicia o socket ('connecting'): é sincronização, não queda.
    // Um número já conectado não regride por causa disso.
    if (c.transient && number.status === 'connected') return;
    if (c.loggedOut) this.log.warn(`Número ${number.label} (${number.phone}) foi desconectado pelo celular (dispositivo removido)`);
    // o número que escaneou o QR pode não ser o digitado no cadastro: corrige com o real
    const phone = c.phone && c.phone !== number.phone ? c.phone : undefined;
    // Aquecimento só para número REALMENTE novo: se já enviou alguma vez, é uma linha
    // estabelecida e limitá-la a 20 envios/dia quebraria o atendimento do cliente.
    let warmup: { warmupStartedAt?: Date } = {};
    if (c.status === 'connected' && !number.warmupStartedAt) {
      const jaEnviou = await this.prisma.messageUsage.findFirst({ where: { numberId: number.id, direction: 'out' }, select: { id: true } });
      if (!jaEnviou) {
        warmup = { warmupStartedAt: new Date() };
        this.log.log(`Número ${number.label} conectou pela primeira vez: aquecimento iniciado`);
      }
    }
    await this.prisma.whatsAppNumber.update({ where: { id: number.id }, data: { status: c.status, ...warmup, ...(phone && { phone }) } }).catch(async (err) => {
      // conflito de unique (tenantId, phone): mantém o telefone antigo, só atualiza status
      if (String(err?.code) === 'P2002') await this.prisma.whatsAppNumber.update({ where: { id: number.id }, data: { status: c.status, ...warmup } });
      else throw err;
    });
    this.gateway.emitNumber(number.tenantId, { id: number.id, status: c.status, qrCode: c.qrCode });
  }

  // ---------- outbound (API) ----------
}
