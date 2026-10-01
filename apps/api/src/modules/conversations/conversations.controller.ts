import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ConversationOrigin, ConversationOutcome, ConversationStatus } from '@prisma/client';
import { ConversationsService } from './conversations.service';
import { FlowEngineService } from '../flows/flow-engine.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { ConversationScopeGuard } from './conversation-scope.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

class ListDto {
  @IsOptional() @IsEnum(ConversationStatus) status?: ConversationStatus;
  @IsOptional() @IsUUID() numberId?: string;
  @IsOptional() @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',').filter(Boolean))) @IsArray() tagIds?: string[];
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsEnum(ConversationOrigin) origin?: ConversationOrigin;
  /** admin: filtrar por atendente */
  @IsOptional() @IsUUID() assigneeId?: string;
  @IsOptional() @IsUUID() cursor?: string;
}
class TransferDto {
  @IsUUID() agentId: string;
}
class SendDto {
  @IsIn(['text', 'image', 'audio', 'video', 'document']) type: 'text' | 'image' | 'audio' | 'video' | 'document';
  @IsOptional() @IsString() @MaxLength(4096) text?: string;
  @IsOptional() media?: { url: string; mimeType?: string; fileName?: string; caption?: string };
  /** chave devolvida por POST /uploads */
  @IsOptional() @IsString() mediaKey?: string;
  @IsOptional() @IsString() quotedExternalId?: string;
  @IsOptional() template?: any;
}
class NoteDto {
  @IsString() @MaxLength(4096) text: string;
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

@Controller('conversations')
@UseGuards(JwtAuthGuard, PermissionsGuard, ConversationScopeGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService, private readonly flows: FlowEngineService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListDto) {
    return this.conversations.list(u.tenantId, u, q);
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

  @Post(':id/release')
  release(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.conversations.release(u.tenantId, id, u);
  }

  @Get('counts')
  counts(@CurrentUser() u: AuthUser, @Query('numberId') numberId?: string) {
    return this.conversations.counts(u.tenantId, u, numberId || undefined);
  }

  @Get(':id')
  one(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.conversations.one(u.tenantId, id);
  }

  @Get(':id/messages')
  messages(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('cursor') cursor?: string) {
    return this.conversations.messages(u.tenantId, id, cursor);
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

  @Patch(':id/status')
  async status(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    const conv = await this.conversations.setStatus(u.tenantId, id, dto.status, u.id, dto.outcome ? { outcome: dto.outcome, value: dto.value, reason: dto.reason } : undefined);
    // fluxo de encerramento roda depois de fechar (a conversa reabre sozinha se ele falar)
    if (dto.status === 'closed' && dto.flowId) {
      await this.flows.startOnClose(u.tenantId, id, dto.flowId).catch(() => undefined);
    }
    return conv;
  }

  @Patch(':id/tags')
  tags(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: TagsDto) {
    return this.conversations.setTags(u.tenantId, id, dto.tagIds);
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
  read(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.conversations.markRead(u.tenantId, id);
  }
}
