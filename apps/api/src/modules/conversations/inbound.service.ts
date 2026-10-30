import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { GAP_RECOVERY_DELAYS_MS, QUEUE_GAP_RECOVERY, QUEUE_OUTBOUND, type GapRecoveryJob, type OutboundJob } from '../whatsapp/queues';
import { resumeNumber } from '../whatsapp/send-queue';
import { Prisma } from '@prisma/client';
import type { Contact, Conversation, Message, WhatsAppNumber } from '@prisma/client';
import { messagePreview } from '@atendo/shared';
import type { InboundEdit, InboundMessage, InboundPresence, InboundReaction, StatusUpdate, NumberStatus } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsageService } from '../billing/usage.service';
import { ConversationsGateway } from './conversations.gateway';
import { ConversationsService, MESSAGE_INCLUDE, inicioDaEspera } from './conversations.service';
import { SurveyRunnerService, type SurveyClaim } from '../satisfaction/survey-runner.service';
import { decidirEntrada, ehConfirmacao, naCarencia, voltandoDepoisDeEncerrado } from './reopen';
import { planoDaRecuperacao } from './gap-recovery-plan';
import { agendaParaRestaurar, escolherDaAgenda, normalizeContactName, nomeDaAgendaTroca, pushNameTrocaNome, trocaNaAgenda } from './contact-name';
import { planRemoval } from '../whatsapp/number-removal';
import { DEFINITIVE_CLOSE } from '../whatsapp/connection-events';
import { warmupStartOnPair } from '../whatsapp/number-warmup';
import { isTicketExempt } from '../ignored-contacts/ignored-contacts';

const isGroupJid = (jid: string) => jid.endsWith('@g.us');

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
/**
 * Resposta a status com foto/vídeo: o tipo já entra na criação, sem a URL — é o que a tela lê
 * como "carregando" até o worker guardar a mídia (`attachQuotedMedia`) ou desistir (`quotedMediaFailed`).
 */
const mimeDoStatusCitado = (msg: InboundMessage) =>
  msg.quotedFromStatus && msg.quotedMedia ? msg.quotedMedia.mimeType ?? (msg.quotedMedia.kind === 'video' ? 'video/mp4' : 'image/jpeg') : undefined;

@Injectable()
export class InboundService {
  private readonly log = new Logger(InboundService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly gateway: ConversationsGateway,
    private readonly conversations: ConversationsService,
    private readonly surveys: SurveyRunnerService,
    @InjectQueue(QUEUE_OUTBOUND) private readonly outbound: Queue<OutboundJob>,
    @InjectQueue(QUEUE_GAP_RECOVERY) private readonly gapRecovery: Queue<GapRecoveryJob>,
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

  /** Chamado pelo worker depois de guardar a foto/vídeo do status que o contato respondeu. */
  async attachQuotedMedia(messageId: string, tenantId: string, key: string, mimeType: string) {
    const m = await this.prisma.message.update({ where: { id: messageId }, data: { quotedMediaUrl: key, quotedMediaMime: mimeType }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(tenantId, this.conversations.present(m));
  }

  /** Não deu para guardar nem a mídia nem a miniatura do status: tira o "carregando" da tela. */
  async quotedMediaFailed(messageId: string, tenantId: string) {
    const m = await this.prisma.message.update({ where: { id: messageId }, data: { quotedMediaMime: null }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(tenantId, this.conversations.present(m));
  }

  // ---------- inbound (worker) ----------

  async ingestInbound(number: WhatsAppNumber, msg: InboundMessage): Promise<{ message: Message; conversation: Conversation; isNew: boolean; isNewContact: boolean; returningAfterClosed: boolean; hoursSinceLastMessage: number | null; fromMe?: boolean; /** confirmação na carência do encerramento: não reabriu e não aciona automação */ quiet?: boolean; /** resposta da pesquisa de satisfação: o processor manda o próximo passo */ survey?: SurveyClaim } | null> {
    // idempotência: o mesmo webhook pode chegar duas vezes. É também o que descarta o eco do
    // que o PAINEL enviou: aquela mensagem já está no banco com este externalId.
    // Por NÚMERO: quando um número nosso fala com outro, o WhatsApp usa o mesmo id nos dois
    // lados — a saída de um não pode descartar a entrada do outro (docs/06-modelo-de-dados.md).
    const exists = await this.prisma.message.findFirst({ where: { numberId: number.id, externalId: msg.externalId }, select: { id: true } });
    if (exists) return null;

    // digitada no celular do cliente, não no painel: entra como enviada
    if (msg.fromMe) return this.ingestFromDevice(number, msg);
    // chegou mensagem de cliente: se o número estava marcado "parou de receber", já voltou
    if (number.receiveStalledAt) await this.voltouAReceber(number.id, number.tenantId);

    let contact = await this.prisma.contact.findUnique({ where: { tenantId_phone: { tenantId: number.tenantId, phone: msg.from } } })
      ?? (isGroupJid(msg.from) ? await this.createGroupContact(number, msg.from) : await this.createContact(number, msg.from, msg.contactName));
    if (msg.contactName) contact = await this.restaurarAgenda(number.tenantId, contact, msg.contactName);
    // o pushName só troca nome que também veio do WhatsApp (ou contato ainda sem nome): nome da
    // ficha ou da agenda não pode ser desfeito pela próxima mensagem do cliente
    if (pushNameTrocaNome(contact, msg.contactName)) {
      contact = await this.prisma.contact.update({ where: { id: contact.id }, data: { name: normalizeContactName(msg.contactName), nameSource: 'whatsapp' } });
    }

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
    // "ok"/"obrigada"/figurinha logo depois de encerrar: entra no histórico e a conversa
    // continua encerrada (reopen.ts → CLOSE_GRACE_MS). Fluxo esperando resposta (pesquisa de
    // satisfação do encerramento) fica de fora: aquela resposta é dele.
    // resposta da pesquisa de satisfação do encerramento: entra no histórico sem reabrir
    // (docs/pesquisa-de-satisfacao.md). Não sendo resposta, a pesquisa sai do caminho e segue normal.
    // grupo nas conversas é sempre chat livre (docs/grupos.md#grupos-nas-conversas): não reabre,
    // não entra na fila, não marca espera. Contato isento (docs/contatos-isentos.md) segue a fila
    // como qualquer atendimento — Aguardando, Atendendo, Encerrado — e só fica fora dos relatórios
    // (`ticketExempt`); dos dois, nenhum aciona automação nem pesquisa
    const livre = contact.isGroup;
    const isento = livre || await isTicketExempt(this.prisma, number.tenantId, contact.phone);
    const pesquisa = !isento && decisao.acao === 'reabrir' ? await this.surveys.claim(conversation!.id, { type: msg.type, text: msg.text, interactiveReplyId: msg.interactiveReplyId }, msg.timestamp) : null;
    const quieta = livre || !!pesquisa || (decisao.acao === 'reabrir' && naCarencia(conversation!.closedAt, msg.timestamp) && ehConfirmacao({ type: msg.type, text: msg.text })
      && !(await this.prisma.flowRun.findFirst({ where: { conversationId: conversation!.id, status: { in: ['running', 'waiting'] } }, select: { id: true } })));
    if (decisao.acao === 'reabrir' && !quieta) {
      // atendimento novo na mesma conversa: volta para a fila, sem dono e sem o desfecho do
      // atendimento anterior — aquele já está congelado no histórico (conversation_events)
      conversation = await this.conversations.setStatusSystem(conversation!.id, 'waiting');
    }
    if (conversation && conversation.ticketExempt !== isento) conversation = await this.aplicarIsencao(conversation, isento, livre);
    // "em atendimento" sem dono (legado da resposta pelo celular): ninguém a via — volta para a fila
    if (conversation && !livre && conversation.status === 'in_progress' && !conversation.assigneeId) {
      conversation = await this.prisma.conversation.update({ where: { id: conversation.id }, data: { status: 'waiting' } });
    }
    if (conversation && livre && conversation.status !== 'in_progress') {
      // conversa livre fica sempre "aberta" e sem dono: qualquer um da equipe responde
      conversation = await this.prisma.conversation.update({ where: { id: conversation.id }, data: { status: 'in_progress', assigneeId: null } });
    }
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { tenantId: number.tenantId, numberId: number.id, contactId: contact.id, status: livre ? 'in_progress' : 'waiting', ticketExempt: isento, origin, originData: msg.referral ? (msg.referral as unknown as Prisma.InputJsonValue) : undefined },
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
        numberId: number.id,
        direction: 'in',
        type: msg.type,
        status: 'delivered',
        ...this.conteudo(msg),
        senderName: msg.group?.senderName,
        senderPhone: msg.group?.senderPhone,
        externalId: msg.externalId,
        quotedId: msg.quotedExternalId,
        quotedMessageId: await this.resolveQuoted(number.id, msg.quotedExternalId),
        quotedPreview: msg.quotedPreview,
        quotedFromStatus: msg.quotedFromStatus ?? false,
        quotedMediaMime: mimeDoStatusCitado(msg),
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
        // encerrada (confirmação na carência): ninguém está esperando resposta
        ...(!quieta && { awaitingSince: inicioDaEspera(conversation.awaitingSince, msg.timestamp) }),
        lastMessagePreview: msg.group?.senderName ? `${msg.group.senderName}: ${this.previa(msg)}`.slice(0, 120) : this.previa(msg),
        unreadCount: { increment: 1 },
        // o contato voltou a falar: agora é ele quem espera, o selo "respondida pelo celular" sai
        deviceReplyAt: null,
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
    // quieta: nada de fluxo, boas-vindas nem agenda — é só o "ok" de quem já foi atendido.
    // Contato isento também não aciona automação, mas entra na fila (acima) como atendimento
    return { message, conversation, isNew: decisao.acao === 'criar', isNewContact, returningAfterClosed: returningAfterClosed && !quieta && !isento, hoursSinceLastMessage, quiet: quieta || isento, ...(pesquisa && { survey: pesquisa }) };
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
    // sem pushName: o desta mensagem é de quem a enviou (o dono do número), não do contato.
    // Nome só da agenda; senão chega na primeira mensagem que o contato mandar.
    const contact = await this.prisma.contact.findUnique({ where: { tenantId_phone: { tenantId: number.tenantId, phone: msg.from } } })
      ?? (isGroupJid(msg.from) ? await this.createGroupContact(number, msg.from) : await this.createContact(number, msg.from));

    // mesma regra da entrada: uma conversa por pessoa neste número (ver reopen.ts)
    let conversation = await this.prisma.conversation.findFirst({
      where: { numberId: number.id, contactId: contact.id },
      orderBy: { lastMessageAt: 'desc' },
    });
    // conversa iniciada do celular: precisa existir no painel, senão a resposta do contato
    // abriria outra e o histórico nasceria partido
    const isNew = !conversation;
    // Eco do que o PAINEL acabou de enviar, chegando antes de a fila gravar o id do provider
    // (a mensagem sai depois do "digitando…" simulado, e o WhatsApp devolve o eco na hora):
    // sem isto ela entrava de novo como "do celular" — duplicada — e reabria a conversa.
    if (conversation) {
      const ecoDoPainel = await this.prisma.message.findFirst({
        where: { conversationId: conversation.id, direction: 'out', externalId: null, type: msg.type, createdAt: { gte: new Date(msg.timestamp.getTime() - 5 * 60_000) }, ...(msg.text ? { text: msg.text } : {}) },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (ecoDoPainel) {
        await this.prisma.message.update({ where: { id: ecoDoPainel.id }, data: { externalId: msg.externalId } }).catch(() => undefined);
        return null;
      }
    }
    // O celular não diz QUEM da equipe escreveu. Atendimento com dono continua com o dono; sem
    // dono, vai para Aguardando com o selo "Respondida pelo celular" (`deviceReplyAt`) para
    // alguém assumir. "Em atendimento" sem dono não pode existir: o atendente só vê na aba dele
    // o que é dele, e a conversa sumia para todo mundo menos o gerente (docs/06-modelo-de-dados.md).
    // Encerrada: falar de novo começa outro atendimento, com a mesma regra. Exceção: a despedida
    // pelo celular logo depois de encerrar ("eu que agradeço", "atendimento finalizado ✅") entra
    // no histórico sem reabrir (carência, reopen.ts).
    // grupo: chat livre, sem reabrir atendimento; contato isento segue a regra comum (docs/contatos-isentos.md)
    const livre = contact.isGroup;
    const isento = livre || await isTicketExempt(this.prisma, number.tenantId, contact.phone);
    if (conversation && conversation.ticketExempt !== isento) conversation = await this.aplicarIsencao(conversation, isento, livre);
    if (livre && conversation && conversation.status !== 'in_progress') conversation = await this.prisma.conversation.update({ where: { id: conversation.id }, data: { status: 'in_progress', assigneeId: null } });
    else if (conversation?.status === 'closed' && !naCarencia(conversation.closedAt, msg.timestamp)) conversation = await this.conversations.setStatusSystem(conversation.id, conversation.assigneeId ? 'in_progress' : 'waiting');
    else if (!livre && conversation?.status === 'in_progress' && !conversation.assigneeId) conversation = await this.prisma.conversation.update({ where: { id: conversation.id }, data: { status: 'waiting' } });
    conversation ??= await this.prisma.conversation.create({
      data: { tenantId: number.tenantId, numberId: number.id, contactId: contact.id, status: livre ? 'in_progress' : 'waiting', ticketExempt: isento },
    });
    const semDono = !livre && conversation.status === 'waiting';

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        numberId: number.id,
        direction: 'out',
        type: msg.type,
        status: 'sent',
        ...this.conteudo(msg),
        externalId: msg.externalId,
        quotedId: msg.quotedExternalId,
        quotedMessageId: await this.resolveQuoted(number.id, msg.quotedExternalId),
        quotedPreview: msg.quotedPreview,
        quotedFromStatus: msg.quotedFromStatus ?? false,
        quotedMediaMime: mimeDoStatusCitado(msg),
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
      data: { lastMessageAt: msg.timestamp, lastMessagePreview: this.previa(msg), awaitingSince: null, ...(semDono && { deviceReplyAt: msg.timestamp }) },
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
   * Grava mensagens antigas vindas do histórico do provider (docs/historico-de-mensagens.md).
   *
   * Não é tráfego novo, então de propósito **não** passa por nada do caminho do webhook: sem
   * `UsageService.record` (não foi enviada nem recebida agora — cobrar seria faturar o passado),
   * sem fluxo/automação, sem mexer em não-lidas, espera, prévia ou status da conversa, sem
   * socket (quem pediu recebe na resposta). Duplicata é descartada pelo `externalId`, que é
   * único por número: a mesma mensagem nunca entra duas vezes, nem com duas abas sincronizando juntas
   * (ver `ingestInbound`). Devolve os ids das que têm mídia — o download vai para uma fila, fora da requisição.
   */
  async importHistory(conversation: { id: string; tenantId: string; numberId: string }, msgs: InboundMessage[]) {
    if (!msgs.length) return { imported: 0, withMedia: [] as string[] };
    const ja = await this.prisma.message.findMany({ where: { numberId: conversation.numberId, externalId: { in: msgs.map((m) => m.externalId) } }, select: { externalId: true } });
    const existentes = new Set(ja.map((m) => m.externalId));
    // da mais antiga para a mais nova: `queueSeq` crescente desempata o mesmo segundo na ordem certa
    const novas = msgs.filter((m) => !existentes.has(m.externalId)).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    if (!novas.length) return { imported: 0, withMedia: [] };

    const { ids, data } = await this.linhasDoHistorico(conversation, novas, true);
    const r = await this.prisma.message.createMany({ data, skipDuplicates: true });
    return { imported: r.count, withMedia: novas.filter((m) => m.media).map((m) => ids.get(m.externalId)!) };
  }

  /**
   * Histórico do aplicativo WhatsApp Business que a Meta manda na coexistência (até 6 meses,
   * docs/meta-cadastro-incorporado.md#coexistência). Igual ao `importHistory` — sem cobrança, sem
   * fluxo, sem não-lidas, sem socket —, mas por número: cria contato e conversa quando faltam, e a
   * conversa nova nasce **encerrada** (é passado; a próxima mensagem do contato abre o atendimento).
   */
  async importBackfill(number: WhatsAppNumber, msgs: InboundMessage[]) {
    const porContato = new Map<string, InboundMessage[]>();
    for (const m of msgs) {
      if (!m.from || isGroupJid(m.from)) continue;
      porContato.set(m.from, [...(porContato.get(m.from) ?? []), m]);
    }
    let imported = 0;
    for (const [phone, lista] of porContato) {
      const nome = lista.find((m) => !m.fromMe && m.contactName)?.contactName;
      const contact = (await this.prisma.contact.findUnique({ where: { tenantId_phone: { tenantId: number.tenantId, phone } } })) ?? (await this.createContact(number, phone, nome));
      const ultima = lista.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)).timestamp;
      const conversation = (await this.prisma.conversation.findFirst({ where: { numberId: number.id, contactId: contact.id }, orderBy: { lastMessageAt: 'desc' } }))
        ?? (await this.prisma.conversation.create({ data: { tenantId: number.tenantId, numberId: number.id, contactId: contact.id, status: 'closed', lastMessageAt: ultima } }));
      const r = await this.importHistory({ id: conversation.id, tenantId: number.tenantId, numberId: number.id }, lista);
      imported += r.imported;
    }
    return imported;
  }

  /**
   * Mensagens que o WhatsApp não entregou ao vivo — número "surdo" ou fora do ar — e que só
   * apareceram no provider depois (lote de histórico do QR; docs/historico-de-mensagens.md#recuperação).
   *
   * "Histórico + alerta": entram no lugar certo da conversa como tráfego real (`imported = false`,
   * ledger de uso), a conversa só se mexe se a recuperada for a mais nova (`planoDaRecuperacao`) e
   * **nada** de fluxo/automação — resposta automática meia hora depois seria pior que nenhuma.
   * Idempotente: o que já está no banco (inclusive apagado no painel) é ignorado pelo `externalId`.
   */
  async recoverGap(number: WhatsAppNumber, msgs: InboundMessage[]) {
    const out = { recovered: 0, conversations: 0, withMedia: [] as string[] };
    const unicas = [...new Map(msgs.map((m) => [m.externalId, m])).values()];
    const existentes = new Set<string>();
    for (let i = 0; i < unicas.length; i += 500) {
      const ja = await this.prisma.message.findMany({ where: { numberId: number.id, externalId: { in: unicas.slice(i, i + 500).map((m) => m.externalId) } }, select: { externalId: true } });
      for (const m of ja) existentes.add(m.externalId!);
    }
    const porContato = new Map<string, InboundMessage[]>();
    for (const m of unicas) {
      if (existentes.has(m.externalId)) continue;
      porContato.set(m.from, [...(porContato.get(m.from) ?? []), m]);
    }
    for (const [phone, lista] of porContato) {
      lista.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const r = await this.recuperarDoContato(number, phone, lista);
      if (!r) continue;
      out.recovered += r.recovered;
      out.conversations++;
      out.withMedia.push(...r.withMedia);
    }
    return out;
  }

  private async recuperarDoContato(number: WhatsAppNumber, phone: string, msgs: InboundMessage[]) {
    const nome = msgs.find((m) => !m.fromMe && m.contactName)?.contactName;
    const contact = await this.prisma.contact.findUnique({ where: { tenantId_phone: { tenantId: number.tenantId, phone } } })
      ?? (isGroupJid(phone) ? await this.createGroupContact(number, phone) : await this.createContact(number, phone, nome));
    let conversation = await this.prisma.conversation.findFirst({ where: { numberId: number.id, contactId: contact.id }, orderBy: { lastMessageAt: 'desc' } });

    if (conversation) {
      // histórico limpo no painel: o que veio antes da limpeza não volta
      const limpo = await this.prisma.conversationEvent.findFirst({ where: { conversationId: conversation.id, type: 'history_cleared' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (limpo) msgs = msgs.filter((m) => m.timestamp > limpo.createdAt);
      // enviada pelo PAINEL cujo id do provider nunca chegou (eco perdido): liga em vez de duplicar
      const ligadas = new Set<string>();
      for (const m of msgs.filter((x) => x.fromMe)) {
        const eco = await this.prisma.message.findFirst({
          where: { conversationId: conversation.id, direction: 'out', externalId: null, type: m.type, createdAt: { gte: new Date(m.timestamp.getTime() - 5 * 60_000), lte: new Date(m.timestamp.getTime() + 5 * 60_000) }, ...(m.text ? { text: m.text } : {}) },
          select: { id: true },
        });
        if (!eco) continue;
        await this.prisma.message.update({ where: { id: eco.id }, data: { externalId: m.externalId } }).catch(() => undefined);
        ligadas.add(m.externalId);
      }
      msgs = msgs.filter((m) => !ligadas.has(m.externalId));
    }
    if (!msgs.length) return null;

    const livre = contact.isGroup;
    const isento = livre || await isTicketExempt(this.prisma, number.tenantId, contact.phone);
    const plano = planoDaRecuperacao(conversation, livre, msgs);
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { tenantId: number.tenantId, numberId: number.id, contactId: contact.id, status: plano.status ?? 'waiting', ticketExempt: isento },
      });
    } else if (plano.status && plano.status !== conversation.status) {
      // chat livre (grupo) fica sempre aberto e sem dono; o resto reabre como a entrada ao vivo
      conversation = livre
        ? await this.prisma.conversation.update({ where: { id: conversation.id }, data: { status: 'in_progress', assigneeId: null } })
        : await this.conversations.setStatusSystem(conversation.id, plano.status);
    }

    const { ids, data } = await this.linhasDoHistorico({ id: conversation.id, numberId: number.id }, msgs, false);
    await this.prisma.message.createMany({ data, skipDuplicates: true });
    // só as que entraram de fato (uma rodada paralela pode ter gravado alguma antes)
    const criadas = await this.prisma.message.findMany({ where: { id: { in: [...ids.values()] } }, include: MESSAGE_INCLUDE, orderBy: { createdAt: 'asc' } });
    if (!criadas.length) return null;

    const ultima = plano.ultima !== undefined ? msgs[plano.ultima] : undefined;
    conversation = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        ...(plano.lastInboundAt && { lastInboundAt: plano.lastInboundAt }),
        ...(ultima && { lastMessageAt: ultima.timestamp, lastMessagePreview: this.previa(ultima) }),
        ...(plano.unreadIncrement && { unreadCount: { increment: plano.unreadIncrement } }),
        ...(plano.awaitingSince !== undefined && { awaitingSince: plano.awaitingSince }),
      },
    });

    for (const m of criadas) {
      await this.usage.record({
        tenantId: number.tenantId,
        numberId: number.id,
        messageId: m.id,
        provider: number.provider,
        direction: m.direction,
        billingCategory: number.provider === 'meta' ? 'service' : 'unofficial',
        contactId: contact.id,
      });
      this.gateway.emitMessage(number.tenantId, this.conversations.present(m));
    }
    this.gateway.emitConversation(number.tenantId, conversation);
    const comMidia = new Set<string>(msgs.filter((m) => m.media).map((m) => ids.get(m.externalId)!));
    return { recovered: criadas.length, withMedia: criadas.filter((m) => comMidia.has(m.id)).map((m) => m.id) };
  }

  /**
   * Agenda a recuperação do que o número pode não ter recebido (whatsapp/gap-recovery.ts). Uma
   * rodada por minuto no máximo: reconexões seguidas não empilham buscas iguais.
   */
  private async agendarRecuperacao(numberId: string) {
    const minuto = Math.floor(Date.now() / 60_000);
    await Promise.all(GAP_RECOVERY_DELAYS_MS.map((delay, i) =>
      this.gapRecovery.add('recover', { numberId }, { delay, jobId: `gap-${numberId}-${minuto}-${i}` }),
    )).catch((err) => this.log.warn(`recuperação do número ${numberId} não agendada: ${err instanceof Error ? err.message : err}`));
  }

  /**
   * Linhas de `messages` para mensagens que chegam fora do webhook (histórico antigo ou recuperação),
   * em ordem. A citada pode estar no próprio lote ou já no banco (do número); fora disso fica só o
   * quotedId/preview. `imported`: anterior à conversa no painel (fora dos relatórios) — a recuperada
   * é tráfego de verdade e entra com `false`.
   */
  private async linhasDoHistorico(conversation: { id: string; numberId: string }, novas: InboundMessage[], imported: boolean) {
    const ids = new Map(novas.map((m) => [m.externalId, randomUUID()]));
    const fora = [...new Set(novas.map((m) => m.quotedExternalId).filter((q): q is string => !!q && !ids.has(q)))];
    const citadas = fora.length
      ? new Map((await this.prisma.message.findMany({ where: { numberId: conversation.numberId, externalId: { in: fora } }, select: { id: true, externalId: true } })).map((m) => [m.externalId!, m.id]))
      : new Map<string, string>();
    const data = novas.map((m) => ({
      id: ids.get(m.externalId)!,
      conversationId: conversation.id,
      numberId: conversation.numberId,
      direction: m.fromMe ? ('out' as const) : ('in' as const),
      type: m.type,
      // já foi entregue; `sent` sem recibo faria o alarme de recebimento parado (receive-stall) disparar
      status: 'delivered' as const,
      ...this.conteudo(m),
      externalId: m.externalId,
      quotedId: m.quotedExternalId,
      quotedMessageId: m.quotedExternalId ? ids.get(m.quotedExternalId) ?? citadas.get(m.quotedExternalId) ?? null : null,
      quotedPreview: m.quotedPreview,
      quotedFromStatus: m.quotedFromStatus ?? false,
      // mídia de status citado não é buscada: o story antigo já sumiu do WhatsApp
      raw: m.raw as Prisma.InputJsonValue,
      imported,
      createdAt: m.timestamp,
    }));
    return { ids, data };
  }

  /** Campos de conteúdo comuns às duas entradas (recebida e digitada no celular). */
  private conteudo(msg: InboundMessage) {
    return {
      text: msg.text,
      mediaMime: msg.media?.mimeType,
      mediaName: msg.media?.fileName,
      content: msg.content ? (msg.content as unknown as Prisma.InputJsonValue) : undefined,
      forwarded: msg.forwarded ?? false,
      forwardingScore: msg.forwardingScore,
    };
  }

  private previa(msg: InboundMessage) {
    return messagePreview({ type: msg.type, text: msg.text, content: msg.content, mediaName: msg.media?.fileName }).slice(0, 120);
  }

  /**
   * A citada pode não estar no banco (status/story, mensagem anterior à integração): aí fica só
   * o `quotedId`. Filtra pelo número: o mesmo `externalId` existe nos dois lados quando um
   * número nosso fala com outro, e a citada é a desta conversa.
   */
  private async resolveQuoted(numberId: string, quotedExternalId?: string): Promise<string | null> {
    if (!quotedExternalId) return null;
    const q = await this.prisma.message.findFirst({ where: { numberId, externalId: quotedExternalId }, select: { id: true } });
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

  /** `numberId`: número que recebeu o recibo — a saída de um número nosso e a entrada do outro têm o mesmo `externalId`. */
  async applyStatus(st: StatusUpdate, numberId?: string) {
    const m = await this.prisma.message.findFirst({ where: { externalId: st.externalId, ...(numberId && { numberId }) }, include: { conversation: { select: { tenantId: true } } } });
    if (!m) return;
    const order = ['pending', 'sent', 'delivered', 'read', 'failed'];
    if (order.indexOf(st.status) <= order.indexOf(m.status) && st.status !== 'failed') return; // não regride
    if (st.status === 'failed' && (m.status === 'delivered' || m.status === 'read')) return; // já chegou: erro tardio é ruído
    const updated = await this.prisma.message.update({ where: { id: m.id }, data: { status: st.status, error: st.error }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(m.conversation.tenantId, this.conversations.present(updated));
    // confirmação de entrega também é sinal de vida do recebimento
    if (m.direction === 'out' && m.numberId && (st.status === 'delivered' || st.status === 'read')) await this.voltouAReceber(m.numberId, m.conversation.tenantId);
    if (m.direction === 'in' && st.status === 'read') await this.lidaNoCelular(m.conversationId, m.conversation.tenantId, m.createdAt);
  }

  /**
   * Número marcado "parou de receber" (whatsapp/receive-stall.ts) deu sinal de vida: desmarca na
   * hora, sem esperar o health check de 5 min — o aviso vermelho some assim que resolve.
   */
  private async voltouAReceber(numberId: string, tenantId: string) {
    const res = await this.prisma.whatsAppNumber.updateMany({ where: { id: numberId, receiveStalledAt: { not: null } }, data: { receiveStalledAt: null } });
    if (!res.count) return;
    await this.agendarRecuperacao(numberId);
    const n = await this.prisma.whatsAppNumber.findUnique({ where: { id: numberId }, select: { id: true, status: true } });
    if (n) this.gateway.emitNumber(tenantId, n);
  }

  /**
   * "Lida" numa mensagem RECEBIDA só vem de um lugar: o próprio cliente abriu a conversa no
   * celular (Evolution repassa o recibo do aparelho; a Meta não manda). O que ele leu no
   * aparelho não é mais não lido no painel: sobra só o que chegou depois dela.
   * Só diminui — o recibo pode chegar atrasado, depois de mensagens novas.
   */
  private async lidaNoCelular(conversationId: string, tenantId: string, ate: Date) {
    const depois = await this.prisma.message.count({ where: { conversationId, direction: 'in', createdAt: { gt: ate } } });
    const res = await this.prisma.conversation.updateMany({ where: { id: conversationId, tenantId, unreadCount: { gt: depois } }, data: { unreadCount: depois } });
    if (!res.count) return;
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (conv) this.gateway.emitConversation(tenantId, conv);
  }

  /**
   * Reação a uma mensagem. Antes ela entrava como mensagem nova ("[unknown]" citando a reagida);
   * agora só marca a reagida (regras em `ConversationsService.setReaction`). Reação a algo que
   * não está no banco é descartada.
   */
  async applyReaction(number: WhatsAppNumber, r: InboundReaction) {
    // filtra pelo número: o mesmo externalId existe nos dois lados quando um número nosso fala com outro
    const m = await this.prisma.message.findFirst({ where: { numberId: number.id, externalId: r.targetExternalId }, select: { id: true } });
    if (!m) return;
    await this.conversations.setReaction(number.tenantId, m.id, { fromMe: r.fromMe, emoji: r.emoji, at: r.timestamp });
  }

  /**
   * Mensagem editada no celular: troca o texto da original. Edição de algo que não está no
   * banco é descartada — virar mensagem nova seria a bolha solta que o WhatsApp não mostra.
   */
  async applyEdit(number: WhatsAppNumber, e: InboundEdit) {
    // filtra pelo número: o mesmo externalId existe nos dois lados quando um número nosso fala com outro
    const m = await this.prisma.message.findFirst({ where: { numberId: number.id, externalId: e.targetExternalId }, select: { id: true } });
    if (!m) return;
    const updated = await this.prisma.message.update({ where: { id: m.id }, data: { text: e.text, editedAt: new Date() }, include: MESSAGE_INCLUDE });
    this.gateway.emitMessage(number.tenantId, this.conversations.present(updated));
  }

  /**
   * A lista de isentos mudou desde a última mensagem (a tela já marca as conversas existentes,
   * isto cobre corrida e lista editada direto no banco). Contato isento só troca a marca: status,
   * dono e espera continuam (docs/contatos-isentos.md). Grupo (chat livre) sai da fila e de quem
   * atendia; deixando de ser livre, a conversa aberta sem dono volta para a fila.
   */
  private aplicarIsencao(conv: Conversation, isento: boolean, livre: boolean) {
    return this.prisma.conversation.update({
      where: { id: conv.id },
      data: livre
        ? { ticketExempt: true, assigneeId: null, awaitingSince: null }
        : { ticketExempt: isento, ...(conv.status === 'in_progress' && !conv.assigneeId && { status: 'waiting' as const }) },
    });
  }

  /**
   * Contato novo: nasce com o nome da agenda do celular, se houver (`phonebook_entries`); senão
   * com o pushName. `upsert` porque duas mensagens da mesma pessoa podem chegar juntas.
   */
  /**
   * "Ficha" do grupo liberado para as conversas: o telefone é o jid e o nome vem da lista de
   * grupos do número (o pushName de cada mensagem é de quem escreveu, não do grupo).
   */
  private async createGroupContact(number: WhatsAppNumber, jid: string) {
    const g = await this.prisma.whatsAppGroup.findUnique({ where: { numberId_jid: { numberId: number.id, jid } }, select: { name: true } });
    return this.prisma.contact.upsert({
      where: { tenantId_phone: { tenantId: number.tenantId, phone: jid } },
      create: { tenantId: number.tenantId, phone: jid, isGroup: true, name: g?.name ?? 'Grupo', nameSource: 'manual' },
      update: { isGroup: true },
    });
  }

  private async createContact(number: WhatsAppNumber, phone: string, pushName?: string) {
    const agenda = escolherDaAgenda(
      await this.prisma.phonebookEntry.findMany({ where: { tenantId: number.tenantId, phone }, take: 10 }),
      number.id,
    );
    const inicial = agenda ? { name: normalizeContactName(agenda.name), nameSource: 'agenda' as const } : { name: normalizeContactName(pushName) || null, nameSource: 'whatsapp' as const };
    return this.prisma.contact.upsert({
      where: { tenantId_phone: { tenantId: number.tenantId, phone } },
      create: { tenantId: number.tenantId, phone, ...inicial },
      update: {},
    });
  }

  /**
   * Nome da sincronização de contatos (agenda do celular). Guarda na agenda do número
   * (`phonebook_entries`) e, se a pessoa já é contato, aplica a ela. Não cria contato: a agenda
   * tem milhares de pessoas e não pode aparecer no painel.
   *
   * O mesmo evento também chega com o pushName de cada mensagem: se o contato já mandou
   * mensagem com exatamente esse nome, não é agenda — nem guarda, nem aplica.
   */
  async applyContactName(number: WhatsAppNumber, c: { phone: string; name: string }, changedContactIds?: Set<string>) {
    const name = normalizeContactName(c.name);
    if (!name) return;
    const contact = await this.prisma.contact.findUnique({
      where: { tenantId_phone: { tenantId: number.tenantId, phone: c.phone } },
      select: { id: true, name: true, nameSource: true },
    });
    const jaVeioEmMensagem = !!contact && !!(await this.prisma.message.findFirst({
      where: { direction: 'in', conversation: { tenantId: number.tenantId, contactId: contact.id }, raw: { path: ['pushName'], equals: c.name } },
      select: { id: true },
    }));
    if (jaVeioEmMensagem) return;
    const chave = { numberId_phone: { numberId: number.id, phone: c.phone } };
    const atual = await this.prisma.phonebookEntry.findUnique({ where: { ...chave, tenantId: number.tenantId }, select: { name: true, previousName: true } });
    const registro = trocaNaAgenda(atual, name);
    if (registro) {
      await this.prisma.phonebookEntry.upsert({
        where: { ...chave, tenantId: number.tenantId },
        create: { tenantId: number.tenantId, numberId: number.id, phone: c.phone, name: registro.name },
        update: registro,
      });
      // nome da agenda trocado fica no log: é o rastro para auditar se a troca era mesmo agenda
      if (atual) this.log.log(`agenda ${number.id} …${c.phone.slice(-4)}: "${atual.name}" → "${registro.name}"`);
    }
    if (!contact || !nomeDaAgendaTroca(contact, name, false)) return;
    await this.prisma.contact.update({ where: { id: contact.id, tenantId: number.tenantId }, data: { name, nameSource: 'agenda' } });
    if (changedContactIds) changedContactIds.add(contact.id);
    else await this.emitContactConversations(number.tenantId, contact.id);
  }

  /**
   * Mensagem chegou com um pushName igual ao nome atual da agenda que acabou de ser trocado: a
   * troca era o nome de perfil do WhatsApp (a pessoa mudou o nome dela sem mandar mensagem e a
   * Evolution avisou como se fosse agenda). Volta a agenda para o nome anterior e, se o contato
   * tinha recebido esse nome pela agenda, ele também. Ver `agendaParaRestaurar`.
   */
  private async restaurarAgenda(tenantId: string, contact: Contact, pushName: string): Promise<Contact> {
    const entradas = await this.prisma.phonebookEntry.findMany({
      where: { tenantId, phone: contact.phone, previousName: { not: null } },
      select: { id: true, numberId: true, name: true, previousName: true },
    });
    let paraContato: string | null = null;
    for (const e of entradas) {
      const nome = agendaParaRestaurar(e, pushName);
      if (!nome) continue;
      await this.prisma.phonebookEntry.update({ where: { id: e.id }, data: { name: nome, previousName: null } });
      this.log.warn(`agenda ${e.numberId} …${contact.phone.slice(-4)}: "${e.name}" era o nome de perfil do WhatsApp, não a agenda — volta para "${nome}"`);
      if (contact.nameSource === 'agenda' && normalizeContactName(contact.name) === normalizeContactName(e.name)) paraContato = nome;
    }
    if (!paraContato) return contact;
    return this.prisma.contact.update({ where: { id: contact.id }, data: { name: paraContato } });
  }

  /**
   * Sincronização completa da agenda do aparelho (job periódico, `contacts-sync.ts`). Passa
   * cada nome pela MESMA regra do webhook (`applyContactName`): guarda na agenda do número e
   * atualiza o nome de quem já é contato, sem criar contato novo. Só processa o que mudou desde a
   * última vez — a agenda tem milhares de linhas e quase nada muda entre uma rodada e outra.
   */
  async syncPhonebook(number: WhatsAppNumber, list: { phone: string; name: string }[]) {
    const currentNames = new Map((await this.prisma.phonebookEntry.findMany({
      where: { tenantId: number.tenantId, numberId: number.id }, select: { phone: true, name: true },
    })).map((entry) => [entry.phone, normalizeContactName(entry.name)]));
    const changedContactIds = new Set<string>();
    let changed = 0;
    try {
      for (const entry of list) {
        const name = normalizeContactName(entry.name);
        if (!name || currentNames.get(entry.phone) === name) continue;
        await this.applyContactName(number, { ...entry, name }, changedContactIds);
        currentNames.set(entry.phone, name);
        changed++;
      }
    } finally {
      // Mesmo com falha parcial, publica uma vez as conversas dos contatos já atualizados.
      if (changedContactIds.size) await this.emitContactConversations(number.tenantId, [...changedContactIds]);
    }
    return { total: list.length, changed };
  }

  /**
   * Contato que nasceu sem nome (conversa começada pelo celular do cliente): pergunta ao
   * provider. O que vier não dá para saber se é agenda ou pushName — entra como `whatsapp`.
   */
  async fillMissingName(number: WhatsAppNumber, contactId: string, lookup: (phone: string) => Promise<string | undefined>) {
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId }, select: { phone: true, name: true } });
    if (!contact || contact.name) return;
    const name = await lookup(contact.phone);
    if (!name) return;
    const r = await this.prisma.contact.updateMany({ where: { id: contactId, name: null }, data: { name, nameSource: 'whatsapp' } });
    if (r.count) await this.emitContactConversations(number.tenantId, contactId);
  }

  /** O nome aparece na lista e no cabeçalho: avisa as telas abertas. */
  private async emitContactConversations(tenantId: string, contactId: string | string[]) {
    const convs = await this.prisma.conversation.findMany({ where: { tenantId, contactId: Array.isArray(contactId) ? { in: contactId } : contactId } });
    const emitted = new Set<string>();
    for (const conversation of convs) {
      if (emitted.has(conversation.id)) continue;
      emitted.add(conversation.id);
      this.gateway.emitConversation(tenantId, conversation);
    }
  }

  /**
   * "Digitando…" do contato. Só repassa ao painel: não cria contato nem conversa (alguém
   * digitando pela primeira vez ainda não é atendimento) e não grava nada.
   */
  async applyPresence(number: WhatsAppNumber, p: InboundPresence) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { tenantId: number.tenantId, numberId: number.id, contact: { phone: p.from } },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });
    if (conversation) this.gateway.emitTyping(number.tenantId, { conversationId: conversation.id, state: p.state });
  }

  async numberConnectionChanged(number: WhatsAppNumber, c: { status: NumberStatus; qrCode?: string; phone?: string; transient?: boolean; loggedOut?: boolean; statusReason?: number }) {
    // Logo após parear, o WhatsApp reinicia o socket ('connecting'): é sincronização, não queda.
    // Um número já conectado não regride por causa disso.
    if (c.transient && number.status === 'connected') return;
    // Fechamento definitivo (401/402/403/406, connection-events.ts) com o número CONECTADO = o
    // WhatsApp (ou alguém no celular) removeu o aparelho ou restringiu a conta. O
    // "Desconectar" do painel marca `disconnected` antes de chamar o provider, então não cai aqui.
    const removido = c.loggedOut && number.status === 'connected' ? planRemoval(number, new Date()) : null;
    if (removido) this.log.warn(`Número ${number.label} (${number.phone}) removido pelo WhatsApp (${c.statusReason ?? 401}: ${DEFINITIVE_CLOSE[c.statusReason ?? 401] ?? 'fechamento definitivo'}) — queda ${removido.waRemovedCount} em 24h, reconexão em pausa até ${removido.reconnectBlockedUntil.toISOString()}`);
    // o número que escaneou o QR pode não ser o digitado no cadastro: corrige com o real
    const phone = c.phone && c.phone !== number.phone ? c.phone : undefined;
    // Aquecimento desligado (a pedido): número novo não começa mais com teto de envios por dia.
    // O aquecimento POR HORA (number-warmup.ts) começa no primeiro QR. QR de novo no mesmo
    // telefone continua a contagem; recomeça se o WhatsApp derrubou o número ou se é outro
    // telefone (warmupStartOnPair). Reinício de servidor ou oscilação de rede não mexem nele.
    const recomeco = c.status === 'connected' && number.status === 'pending_qr' ? warmupStartOnPair(number, c.phone) : null;
    const warmup: { warmupStartedAt?: Date; sessionStartedAt?: Date; syncStartedAt?: Date } = recomeco ? { sessionStartedAt: recomeco } : {};
    // voltou a conectar: o WhatsApp entrega em lotes o que chegou enquanto estava fora, e demora.
    // O painel avisa "sincronizando" por alguns minutos a partir daqui (NUMBER_SYNC_NOTICE_MS no front)
    if (c.status === 'connected' && number.status !== 'connected') warmup.syncStartedAt = new Date();
    await this.prisma.whatsAppNumber.update({ where: { id: number.id }, data: { status: c.status, ...warmup, ...removido, ...(phone && { phone }) } }).catch(async (err) => {
      // conflito de unique (tenantId, phone): mantém o telefone antigo, só atualiza status
      if (String(err?.code) === 'P2002') await this.prisma.whatsAppNumber.update({ where: { id: number.id }, data: { status: c.status, ...warmup, ...removido } });
      else throw err;
    });
    this.gateway.emitNumber(number.tenantId, { id: number.id, status: c.status, qrCode: c.qrCode });
    // reconectou (QR lido): a fila do número, parada enquanto estava fora, retoma em ordem
    if (c.status === 'connected' && number.status !== 'connected') {
      const n = await resumeNumber(this.prisma, this.outbound, number.id);
      if (n) this.log.log(`Número ${number.label} reconectou: retomando ${n} conversa(s) na fila de envio`);
      // o que chegou enquanto estava fora (ou "surdo") vem no histórico do pareamento: traz para o painel
      if (number.provider === 'evolution') await this.agendarRecuperacao(number.id);
    }
  }

  // ---------- outbound (API) ----------
}
