import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, forwardRef, BadRequestException } from '@nestjs/common';
import { parsePortableTicketTypeFile, toBundle } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { BillingModule } from '../billing/billing.module';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';
import { ConversationsModule } from '../conversations/conversations.module';
import { createTicketTypesFromPortable, ticketTypesToPortable } from '../tenants/portable-db';
import {
  TicketsService, CreateTicketDto, TypeDto, PresetDto, UpdateTicketDto, CommentDto, StatusDto, HoldDto, NoteDto, TransferDto, ParticipantDto, HoldReasonDto, ListDto,
} from './tickets.service';

export { TicketsService } from './tickets.service';

@Controller('tickets')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PermissionsGuard, FeatureGuard)
@RequireFeature('tickets')
class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListDto) { return this.tickets.list(u, q); }

  @Get('summary')
  summary(@CurrentUser() u: AuthUser) { return this.tickets.summary(u); }

  @Get('options')
  options(@CurrentUser() u: AuthUser) { return this.tickets.options(u); }

  @Post('hold-reasons') @RequirePermission('tickets.manage')
  createReason(@CurrentUser() u: AuthUser, @Body() dto: HoldReasonDto) { return this.tickets.saveHoldReason(u, null, dto); }

  @Patch('hold-reasons/:id') @RequirePermission('tickets.manage')
  updateReason(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HoldReasonDto) { return this.tickets.saveHoldReason(u, id, dto); }

  @Delete('hold-reasons/:id') @RequirePermission('tickets.manage')
  deleteReason(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.tickets.deleteHoldReason(u, id); }

  @Get('types')
  types(@CurrentUser() u: AuthUser) { return this.tickets.listTypes(u.tenantId); }

  /** Exportar / importar tipos (docs/20-modelos-de-perfil.md): o mesmo arquivo cabe no modelo de perfil. */
  @Get('types/export') @RequirePermission('tickets.manage')
  async exportTypes(@CurrentUser() u: AuthUser) {
    const { items, warnings } = await ticketTypesToPortable(this.prisma, u.tenantId);
    return { bundle: toBundle('ticket-type', items), warnings };
  }

  @Post('types/import') @RequirePermission('tickets.manage')
  async importTypes(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    let items;
    try { items = parsePortableTicketTypeFile((body as { portable?: unknown })?.portable ?? body); } catch (e) { throw new BadRequestException(e instanceof Error ? e.message : 'Arquivo inválido.'); }
    const r = await createTicketTypesFromPortable(this.prisma, u.tenantId, items);
    return { ...r, types: await this.tickets.listTypes(u.tenantId) };
  }

  @Post('types') @RequirePermission('tickets.manage')
  createType(@CurrentUser() u: AuthUser, @Body() dto: TypeDto) { return this.tickets.saveType(u, null, dto); }

  @Post('types/preset') @RequirePermission('tickets.manage')
  preset(@CurrentUser() u: AuthUser, @Body() dto: PresetDto) { return this.tickets.applyPreset(u, dto.niche); }

  @Patch('types/:id') @RequirePermission('tickets.manage')
  updateType(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TypeDto) { return this.tickets.saveType(u, id, dto); }

  @Delete('types/:id') @RequirePermission('tickets.manage')
  deleteType(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.tickets.deleteType(u, id); }

  @Get('conversation/:conversationId')
  byConversation(@CurrentUser() u: AuthUser, @Param('conversationId', ParseUUIDPipe) conversationId: string) { return this.tickets.byConversation(u, conversationId); }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.tickets.get(u, id); }

  @Post() @RequirePermission('tickets.create')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTicketDto) { return this.tickets.create(u, dto); }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto) { return this.tickets.update(u, id, dto); }

  @Post(':id/comments')
  comment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto) { return this.tickets.comment(u, id, dto.body); }

  @Post(':id/status')
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) { return this.tickets.setStatus(u, id, dto); }

  @Post(':id/hold')
  hold(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HoldDto) { return this.tickets.hold(u, id, dto); }

  @Post(':id/resume')
  resume(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) { return this.tickets.resume(u, id, dto.note); }

  @Post(':id/transfer')
  transfer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferDto) { return this.tickets.transfer(u, id, dto); }

  @Post(':id/participants')
  addParticipant(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ParticipantDto) { return this.tickets.addParticipant(u, id, dto); }

  @Delete(':id/participants/:userId')
  removeParticipant(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) { return this.tickets.removeParticipant(u, id, userId); }
}

@Module({ imports: [AuthModule, BillingModule, forwardRef(() => ConversationsModule)], controllers: [TicketsController], providers: [TicketsService], exports: [TicketsService] })
export class TicketsModule {}
