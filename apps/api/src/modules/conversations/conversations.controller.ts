import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { ConversationOrigin, ConversationOutcome, ConversationStatus } from '@prisma/client';
import { ConversationsService, FORWARD_MAX_TARGETS } from './conversations.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FlowEngineService } from '../flows/flow-engine.service';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';
import { NumbersService } from '../whatsapp/numbers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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
  @IsOptional() template?: any;
  /** número que a tela mostrava ao enviar — se a conversa estiver em outro, 409 sem enviar.
   *  Só confere: quem escolhe o número é a conversa, nunca o payload. */
  @IsOptional() @IsUUID() expectedNumberId?: string;
  /** gerada pela tela por envio: repetir a requisição com a mesma chave devolve a mesma mensagem */
  @IsOptional() @IsString() @MaxLength(100) idempotencyKey?: string;
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
class StatusDto {
  @IsEnum(ConversationStatus) status: ConversationStatus;
  /** desfecho do atendimento, só no encerramento */
  @IsOptional() @IsEnum(ConversationOutcome) outcome?: ConversationOutcome;
  @IsOptional() @IsNumber() @Min(0) @Max(9_999_999) value?: number;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
  /** fluxo disparado ao encerrar (pesquisa de satisfação, pós-venda…) */
  @IsOptional() @IsUUID() flowId?: string;
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
  send(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SendDto) {
    // mediaKey só pode apontar para o storage do próprio tenant
    if (dto.mediaKey && !dto.mediaKey.startsWith(`media/${u.tenantId}/`)) throw new BadRequestException('mediaKey inválida');
    return this.conversations.send(u.tenantId, u, id, dto);
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
   * Encaminha a mensagem para outras conversas. Cada destino é um envio normal (quota, janela
   * da Meta, posse); o que falhar num destino volta em `failed` sem derrubar os outros.
   */
  @Post(':id/messages/:messageId/forward')
  forward(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string, @Body() dto: ForwardDto) {
    return this.conversations.forward(u.tenantId, u, id, messageId, dto.targetConversationIds);
  }

  @Patch(':id/status')
  async status(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    const conv = await this.conversations.setStatus(u.tenantId, id, dto.status, u.id, dto.outcome ? { outcome: dto.outcome, value: dto.value, reason: dto.reason } : undefined);
    // Fluxo de encerramento roda depois de fechar (a conversa reabre sozinha se ele falar).
    // Sem escolha no modal, vale o fluxo padrão configurado — é o caso comum: pesquisa de
    // satisfação que precisa sair em TODO encerramento, e depender de alguém lembrar de
    // escolher na hora é o mesmo que não existir.
    if (dto.status === 'closed') {
      const padrao = dto.flowId ?? (await this.prisma.tenantSettings.findUnique({ where: { tenantId: u.tenantId }, select: { onCloseFlowId: true } }))?.onCloseFlowId;
      if (padrao) await this.flows.startOnClose(u.tenantId, id, padrao).catch(() => undefined);
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
