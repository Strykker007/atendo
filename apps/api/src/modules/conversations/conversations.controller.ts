import { BadRequestException, UnprocessableEntityException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, IsEnum, IsIn, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ConversationOrigin, ConversationOutcome, ConversationStatus } from '@prisma/client';
import { ConversationsService, DELETE_NOTICE, FORWARD_MAX_TARGETS } from './conversations.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FlowEngineService } from '../flows/flow-engine.service';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';
import { NumbersService } from '../whatsapp/numbers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TemplateChoiceDto } from '../whatsapp/template.dto';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { ConversationScopeGuard } from './conversation-scope.guard';
import { BOT_PAUSE_MINUTES } from './bot-pause';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import type { SetPrimaryTagInput } from '@atendo/shared';

class ListDto {
  @IsOptional() @IsEnum(ConversationStatus) status?: ConversationStatus;
  @IsOptional() @IsUUID() numberId?: string;
  /** id do departamento ou `none` (só as sem departamento) */
  @IsOptional() @ValidateIf((_, v) => v !== 'none') @IsUUID() departmentId?: string;
  @IsOptional() @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',').filter(Boolean))) @IsArray() tagIds?: string[];
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsEnum(ConversationOrigin) origin?: ConversationOrigin;
  /** admin: filtrar por atendente */
  @IsOptional() @IsUUID() assigneeId?: string;
  /** `waiting` = quem espera resposta há mais tempo primeiro */
  @IsOptional() @IsIn(['recent', 'waiting']) sort?: 'recent' | 'waiting';
  @IsOptional() @IsUUID() cursor?: string;
}
class TransferDto {
  @IsUUID() agentId: string;
}
class DepartmentDto {
  /** null = tirar de departamento */
  @ValidateIf((_, v) => v !== null) @IsUUID() departmentId: string | null;
}
class SendDto {
  @IsIn(['text', 'image', 'audio', 'video', 'document']) type: 'text' | 'image' | 'audio' | 'video' | 'document';
  @IsOptional() @IsString() @MaxLength(4096) text?: string;
  @IsOptional() media?: { url: string; mimeType?: string; fileName?: string; caption?: string };
  /** chave devolvida por POST /uploads */
  @IsOptional() @IsString() mediaKey?: string;
  @IsOptional() @IsString() quotedExternalId?: string;
  /** template aprovado (Meta) — o jeito de falar com quem está fora da janela de 24h */
  @IsOptional() @ValidateNested() @Type(() => TemplateChoiceDto) template?: TemplateChoiceDto;
  /** número que a tela mostrava ao enviar — se a conversa estiver em outro, 409 sem enviar.
   *  Só confere: quem escolhe o número é a conversa, nunca o payload. */
  @IsOptional() @IsUUID() expectedNumberId?: string;
  /** gerada pela tela por envio: repetir a requisição com a mesma chave devolve a mesma mensagem */
  @IsOptional() @IsString() @MaxLength(100) idempotencyKey?: string;
  /** caracteres que o atendente não digitou (resposta rápida, colado, só mídia): "digitando…" simulado */
  @IsOptional() @IsInt() @Min(0) @Max(4096) simulateTypingChars?: number;
}
class StartDto {
  @IsUUID() numberId: string;
  /** contato existente OU telefone (DDI + DDD + número) */
  @ValidateIf((o) => !o.phone) @IsUUID() contactId?: string;
  @ValidateIf((o) => !o.contactId) @IsString() @MaxLength(20) phone?: string;
  /** nome do contato novo (só quando vem `phone` e ele ainda não existe) */
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  /** texto livre (Evolution, ou Meta dentro da janela de 24h) */
  @IsOptional() @IsString() @MaxLength(4096) text?: string;
  /** template aprovado — obrigatório na Meta fora da janela */
  @IsOptional() @ValidateNested() @Type(() => TemplateChoiceDto) template?: TemplateChoiceDto;
  @IsOptional() @IsString() @MaxLength(100) idempotencyKey?: string;
}
class EditMessageDto {
  @IsString() @IsNotEmpty() @MaxLength(4096) text: string;
}
class ReactDto {
  /** um emoji (pode ter vários code points, ex.: 👍🏽); vazio = retirar a reação */
  @IsString() @MaxLength(16) emoji: string;
}
class ForwardDto {
  /** conversas de destino; o WhatsApp limita a 5 por encaminhamento */
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(FORWARD_MAX_TARGETS) @IsUUID('4', { each: true }) targetConversationIds: string[];
}
class NoteDto {
  @IsString() @IsNotEmpty() @MaxLength(4096) text: string;
}
class SaleItemDto {
  /** opcional: dá para registrar só o valor */
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsNumber() @Min(0) @Max(9_999_999) value: number;
}
class StatusDto {
  @IsEnum(ConversationStatus) status: ConversationStatus;
  /** desfecho do atendimento, só no encerramento */
  @IsOptional() @IsEnum(ConversationOutcome) outcome?: ConversationOutcome;
  /** valor da venda — opcional: "Comprou" sem valor registra o desfecho, mas não gera venda */
  @IsOptional() @IsNumber() @Min(0) @Max(9_999_999)
  value?: number;
  /** venda: o que foi comprado e observações do fechamento */
  @IsOptional() @IsString() @MaxLength(500) products?: string;
  /** venda em lista: o total passa a ser a soma dos itens (o `value` enviado é ignorado) */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => SaleItemDto) items?: SaleItemDto[];
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
  /**
   * Fluxo disparado ao encerrar (pesquisa de satisfação, pós-venda…). Ausente = padrão do
   * desfecho (ou o geral); `null` = o atendente escolheu "Nenhum" e nada dispara.
   */
  @IsOptional() @IsUUID() flowId?: string | null;
}
class BulkCloseDto {
  /**
   * Teto de 200 por chamada: é mais do que a tela mostra de uma vez e evita que um pedido
   * sozinho segure a conexão fechando mil conversas.
   */
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(200) @IsUUID('4', { each: true }) ids: string[];
  @IsOptional() @IsEnum(ConversationOutcome) outcome?: ConversationOutcome;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
class ContactDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(1000) note1?: string;
  @IsOptional() @IsString() @MaxLength(1000) note2?: string;
  /** volta a receber mensagens automáticas (o contato pediu ao atendente) — só `true` */
  @IsOptional() @IsIn([true]) resubscribe?: true;
}
class TagsDto {
  @IsArray() @IsUUID('4', { each: true }) tagIds: string[];
}
class BotPauseDto {
  /** minutos (30, 60, 240); ausente/nulo = até retomar manualmente */
  @IsOptional() @IsIn([...BOT_PAUSE_MINUTES]) minutes?: number | null;
}
class PrimaryTagDto implements SetPrimaryTagInput {
  /** null = tirar da etapa (coluna "Sem etapa" do Kanban) */
  @ValidateIf((_, v) => v !== null) @IsUUID() tagId: string | null;
}

class TypingDto {
  @IsOptional() @IsIn(['composing', 'paused']) state?: 'composing' | 'paused';
}

@Controller('conversations')
@UseGuards(JwtAuthGuard, PermissionsGuard, ConversationScopeGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService, private readonly flows: FlowEngineService, private readonly prisma: PrismaService, private readonly numbers: NumbersService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListDto) {
    return this.conversations.list(u.tenantId, u, q);
  }

  /**
   * Encerrar vários de uma vez.
   *
   * O `ConversationScopeGuard` não cobre esta rota — ele olha `:id` e aqui a lista vem no
   * corpo. Quem recorta é o service, e isso está dito lá.
   */
  @Post('bulk/close')
  bulkClose(@CurrentUser() u: AuthUser, @Body() dto: BulkCloseDto) {
    return this.conversations.closeMany(u.tenantId, u, dto.ids, dto.outcome ? { outcome: dto.outcome, reason: dto.reason } : undefined);
  }

  /** Busca do "Nova conversa": contatos da base + agenda do aparelho (Evolution). */
  @Get('start/contacts')
  startCandidates(@CurrentUser() u: AuthUser, @Query('q') q = '') {
    return this.conversations.startCandidates(u.tenantId, u, String(q).slice(0, 100));
  }

  /**
   * Iniciar conversa (disparo ativo): o atendente fala primeiro com um contato existente ou um
   * telefone novo. Fora da rota `:id`, então o escopo de número é checado no service.
   */
  @Post('start')
  async start(@CurrentUser() u: AuthUser, @Body() dto: StartDto) {
    let template;
    if (dto.template) {
      // o número tem de ser do tenant ANTES de perguntar à Meta pelos templates dele
      await this.prisma.whatsAppNumber.findFirstOrThrow({ where: { id: dto.numberId, tenantId: u.tenantId, deletedAt: null }, select: { id: true } });
      template = { definition: await this.numbers.template(dto.numberId, dto.template.name, dto.template.language), header: dto.template.header, body: dto.template.body };
    }
    return this.conversations.start(u.tenantId, u, { numberId: dto.numberId, contactId: dto.contactId, phone: dto.phone, name: dto.name, text: dto.text, template, idempotencyKey: dto.idempotencyKey }, (numberId, phone) => this.numbers.hasWhatsApp(numberId, phone));
  }

  /** Nota interna (cadeado) — só equipe vê. */
  @Post(':id/notes')
  note(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: NoteDto) {
    return this.conversations.note(u.tenantId, u, id, dto.text);
  }

  @Post(':id/claim')
  claim(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.conversations.claim(u.tenantId, id, u);
  }

  @Post(':id/transfer')
  transfer(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: TransferDto) {
    return this.conversations.transfer(u.tenantId, id, dto.agentId, u);
  }

  /** Transferir para outro departamento: vai para a fila (Aguardando) dele. */
  @Patch(':id/department')
  department(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DepartmentDto) {
    return this.conversations.setDepartment(u.tenantId, id, dto.departmentId ?? null, u);
  }

  @Post(':id/release')
  release(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.conversations.release(u.tenantId, id, u);
  }

  /**
   * Vagas de contato frio do número não oficial nas últimas 24 h (docs/envio.md#envio-frio) —
   * a tela mostra "restam N" antes do atendente esbarrar no limite. `null` no número oficial.
   */
  @Get('cold-quota')
  coldQuota(@CurrentUser() u: AuthUser, @Query('numberId') numberId = '') {
    if (!/^[0-9a-f-]{36}$/i.test(numberId)) throw new BadRequestException('numberId inválido');
    return this.conversations.coldQuota(u.tenantId, numberId);
  }

  @Get('counts')
  counts(@CurrentUser() u: AuthUser, @Query('numberId') numberId?: string, @Query('departmentId') departmentId?: string) {
    // fora do DTO: valida aqui o mesmo formato do filtro da lista
    const dept = departmentId === 'none' || (departmentId && /^[0-9a-f-]{36}$/i.test(departmentId)) ? departmentId : undefined;
    return this.conversations.counts(u.tenantId, u, numberId || undefined, dept);
  }

  @Get(':id')
  one(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.conversations.one(u.tenantId, id);
  }

  @Get(':id/messages')
  messages(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('cursor') cursor?: string) {
    return this.conversations.messages(u.tenantId, id, cursor);
  }

  /** Histórico do atendimento: quem assumiu, transferiu, encerrou e quando. */
  @Get(':id/events')
  events(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.conversations.events(u.tenantId, id);
  }

  @Post(':id/messages')
  async send(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SendDto) {
    // mediaKey só pode apontar para o storage do próprio tenant
    if (dto.mediaKey && !dto.mediaKey.startsWith(`media/${u.tenantId}/`)) throw new BadRequestException('mediaKey inválida');
    if (dto.template) {
      // janela expirada no composer: o template é conferido na Meta no número DA CONVERSA
      const conv = await this.prisma.conversation.findFirstOrThrow({ where: { id, tenantId: u.tenantId }, select: { numberId: true, contactId: true, number: { select: { provider: true } } } });
      if (conv.number.provider !== 'meta') throw new BadRequestException('Template só existe na API oficial (Meta).');
      const definition = await this.numbers.template(conv.numberId, dto.template.name, dto.template.language);
      const msg = await this.conversations.templateMessage(u.tenantId, conv.contactId, definition, dto.template, { agentName: u.name });
      return this.conversations.send(u.tenantId, u, id, { ...msg, expectedNumberId: dto.expectedNumberId, idempotencyKey: dto.idempotencyKey });
    }
    return this.conversations.send(u.tenantId, u, id, { ...dto, template: undefined });
  }

  @Post(':id/messages/:messageId/resend')
  resend(@CurrentUser() u: AuthUser, @Param('messageId') messageId: string) {
    return this.conversations.resend(u.tenantId, messageId);
  }

  /**
   * Reação do atendente a uma mensagem (emoji vazio = retirar). Só grava depois que o provider
   * aceitou: reação que aparece no painel e não chegou no celular do contato engana quem atende.
   */
  @Post(':id/messages/:messageId/react')
  async react(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string, @Body() dto: ReactDto) {
    const alvo = await this.conversations.reactionTarget(u.tenantId, u, id, messageId);
    await this.numbers.react(alvo.numberId, { to: alvo.to, targetExternalId: alvo.targetExternalId, targetFromMe: alvo.targetFromMe, emoji: dto.emoji });
    return this.conversations.setReaction(u.tenantId, alvo.messageId, { fromMe: true, emoji: dto.emoji, at: new Date() });
  }

  /**
   * Apagar mensagem (docs/apagar-mensagens.md). Enviada por nós e dentro do prazo: pede ao
   * provider "apagar para todos"; se ele não tiver a operação (Meta) ou recusar, apaga só no
   * painel e devolve `notice` para a tela avisar. A mensagem nunca some: vira "apagada por X".
   */
  @Delete(':id/messages/:messageId')
  async deleteMessage(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string) {
    const plan = await this.conversations.deletionPlan(u.tenantId, u, id, messageId);
    let forEveryone = false;
    let notice = plan.notice;
    if (plan.revoke) {
      try {
        forEveryone = await this.numbers.revoke(plan.revoke.numberId, { to: plan.revoke.to, externalId: plan.revoke.externalId });
        if (!forEveryone) notice = DELETE_NOTICE.unsupported;
      } catch (err) {
        notice = DELETE_NOTICE.refused(err instanceof Error ? err.message : String(err));
      }
    }
    return this.conversations.markDeleted(u.tenantId, u, plan, { forEveryone, notice });
  }

  /**
   * Editar mensagem de texto enviada pelo número, de qualquer origem (docs/editar-mensagens.md). Enviada: edita no WhatsApp do
   * contato primeiro (Evolution, até 15 min) e só grava se o provider aceitar — texto novo no
   * painel que não chegou ao contato engana quem atende. Na fila: só troca o texto.
   */
  @Patch(':id/messages/:messageId')
  @RequirePermission('conversations.edit_message')
  async editMessage(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string, @Body() dto: EditMessageDto) {
    const plan = await this.conversations.editPlan(u.tenantId, u, id, messageId, dto.text);
    if (plan.provider) {
      try {
        const ok = await this.numbers.editMessage(plan.provider.numberId, { ...plan.provider, text: dto.text.trim() });
        if (!ok) throw new UnprocessableEntityException('Este número não permite editar mensagens enviadas.');
      } catch (err) {
        if (err instanceof UnprocessableEntityException) throw err;
        throw new UnprocessableEntityException(`O WhatsApp recusou a edição: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return this.conversations.markEdited(u.tenantId, u, plan, dto.text);
  }

  /** Conteúdo original de uma mensagem apagada — só para quem audita. */
  @Get(':id/messages/:messageId/original')
  @RequirePermission('conversations.view_deleted')
  deletedOriginal(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string) {
    return this.conversations.deletedOriginal(u.tenantId, id, messageId);
  }

  /** Limpar o histórico da conversa (só no painel; a conversa continua existindo). */
  @Delete(':id/messages')
  @RequirePermission('conversations.delete_chat')
  clearHistory(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.conversations.clearHistory(u.tenantId, u, id);
  }

  /**
   * Encaminha a mensagem para outras conversas. Cada destino é um envio normal (quota, janela
   * da Meta, posse); o que falhar num destino volta em `failed` sem derrubar os outros.
   */
  @Post(':id/messages/:messageId/forward')
  forward(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string, @Body() dto: ForwardDto) {
    return this.conversations.forward(u.tenantId, u, id, messageId, dto.targetConversationIds);
  }

  @Patch(':id/status')
  async status(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    const conv = await this.conversations.setStatus(u.tenantId, id, dto.status, u.id, dto.outcome ? { outcome: dto.outcome, value: dto.value, reason: dto.reason, products: dto.products, items: dto.items, notes: dto.notes } : undefined);
    // Fluxo de encerramento roda depois de fechar (a conversa reabre sozinha se ele falar).
    // Sem escolha no modal, vale o fluxo padrão configurado — é o caso comum: pesquisa de
    // satisfação que precisa sair em TODO encerramento, e depender de alguém lembrar de
    // escolher na hora é o mesmo que não existir.
    // O padrão do desfecho (Comprou/Não comprou/Sem resultado) ganha do geral. `null` explícito
    // é "Nenhum" escolhido no modal — não cai no padrão.
    if (dto.status === 'closed') {
      let fluxo = dto.flowId;
      if (fluxo === undefined) {
        const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId: u.tenantId }, select: { onCloseFlowId: true, wonFlowId: true, lostFlowId: true, noneFlowId: true } });
        const porDesfecho = { won: s?.wonFlowId, lost: s?.lostFlowId, none: s?.noneFlowId }[dto.outcome ?? 'none'];
        fluxo = porDesfecho ?? s?.onCloseFlowId ?? null;
      }
      if (fluxo) await this.flows.startOnClose(u.tenantId, id, fluxo).catch(() => undefined);
    }
    return conv;
  }

  /** Pausar o robô (fluxos) só nesta conversa. Interrompe o fluxo em andamento. */
  @Post(':id/bot/pause')
  @UseGuards(FeatureGuard)
  @RequireFeature('flows')
  pauseBot(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: BotPauseDto) {
    return this.flows.pauseBot(u.tenantId, id, u, dto.minutes ?? null);
  }

  @Post(':id/bot/resume')
  @UseGuards(FeatureGuard)
  @RequireFeature('flows')
  resumeBot(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.flows.resumeBot(u.tenantId, id, u);
  }

  @Patch(':id/tags')
  tags(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: TagsDto) {
    return this.conversations.setTags(u.tenantId, id, dto.tagIds);
  }

  /** Tag principal = coluna no Kanban. Arrastar o card e promover pílula caem aqui. */
  @Patch(':id/primary-tag')
  primaryTag(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: PrimaryTagDto) {
    return this.conversations.setPrimaryTag(u.tenantId, id, dto.tagId);
  }

  /** Ficha do contato: nome, e-mail, endereço e observações. */
  @Patch('contacts/:contactId')
  @RequirePermission('contacts.edit')
  updateContact(@CurrentUser() u: AuthUser, @Param('contactId') contactId: string, @Body() dto: ContactDto) {
    return this.conversations.updateContact(u.tenantId, contactId, dto);
  }

  @Patch('contacts/:contactId/tags')
  contactTags(@CurrentUser() u: AuthUser, @Param('contactId') contactId: string, @Body() dto: TagsDto) {
    return this.conversations.setContactTags(u.tenantId, contactId, dto.tagIds);
  }

  /**
   * Atendente digitando: `composing` (renovado pelo painel a cada ~2 s enquanto digita) mostra
   * "digitando…" ao contato; `paused` (parou, enviou, saiu) apaga. Só número não oficial, conversa
   * aberta e número conectado. Responde na hora.
   */
  @Post(':id/typing')
  @HttpCode(204)
  async typing(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: TypingDto) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, tenantId: u.tenantId, status: { not: 'closed' }, number: { provider: 'evolution', status: 'connected' } },
      select: { numberId: true, contact: { select: { phone: true } } },
    });
    if (conv) this.numbers.setTyping(conv.numberId, conv.contact.phone, dto.state ?? 'composing');
  }

  @Post(':id/read')
  async read(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const conv = await this.conversations.markRead(u.tenantId, id);
    // abrir a conversa = estar olhando: assina o "digitando…" do contato, sem esperar o provider
    void this.prisma.contact.findUnique({ where: { id: conv.contactId }, select: { phone: true } })
      .then((c) => c && this.numbers.subscribePresence(conv.numberId, c.phone))
      .catch(() => undefined);
    return conv;
  }
}
