import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsHexColor, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

export type CloseReasonOutcome = 'won' | 'lost' | 'both';
export const CLOSE_REASONS_MAX = 100;

class CloseReasonDto {
  @IsString() @MaxLength(80) name: string;
  @IsOptional() @IsHexColor() color?: string;
  /** em qual resultado aparece */
  @IsOptional() @IsIn(['won', 'lost', 'both']) outcome?: CloseReasonOutcome;
  /** motivo de atendimento interno: só no encerramento interno, e o atendimento sai dos relatórios */
  @IsOptional() @IsBoolean() ignoreInReports?: boolean;
  @IsOptional() @IsBoolean() requiresTag?: boolean;
}
class UpdateCloseReasonDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsIn(['won', 'lost', 'both']) outcome?: CloseReasonOutcome;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() ignoreInReports?: boolean;
  @IsOptional() @IsBoolean() requiresTag?: boolean;
}
class OrderDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsUUID('4', { each: true }) ids: string[];
}

const select = { id: true, name: true, color: true, outcome: true, ignoreInReports: true, requiresTag: true, position: true, isActive: true } as const;

/**
 * Regras do motivo no encerramento — usado pelo `ConversationsService` (individual e em massa).
 * Obrigatório quando há motivo ATIVO para o resultado: empresa sem lista (ou só com motivos do
 * outro resultado) encerra sem motivo, em vez de travar o atendimento.
 *
 * Encerramento interno (`internal`) só aceita motivo `ignoreInReports`, e o normal só aceita os
 * outros: é isso que impede quem não tem `conversations.close_internal` de tirar um atendimento
 * do relatório escolhendo o motivo interno direto pela API.
 */
@Injectable()
export class CloseReasonsService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(tenantId: string, outcome: 'won' | 'lost' | 'none' | undefined, closeReasonId?: string | null, internal = false) {
    if (!internal && (!outcome || outcome === 'none')) return null;
    const pool: Prisma.CloseReasonWhereInput = internal
      ? { tenantId, isActive: true, ignoreInReports: true }
      : { tenantId, isActive: true, ignoreInReports: false, outcome: { in: [outcome!, 'both'] } };
    if (closeReasonId) {
      const r = await this.prisma.closeReason.findFirst({ where: { ...pool, id: closeReasonId }, select: { id: true, name: true, requiresTag: true } });
      if (!r) throw new BadRequestException('Motivo inválido para este resultado.');
      return r;
    }
    if (await this.prisma.closeReason.count({ where: pool })) {
      const s = internal ? null : await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { wonLabel: true, lostLabel: true } });
      const rotulo = internal ? 'Atendimento interno' : outcome === 'won' ? (s?.wonLabel ?? 'Comprou') : (s?.lostLabel ?? 'Não comprou');
      throw new BadRequestException({ code: 'close_reason_required', message: `Escolha o motivo do encerramento (“${rotulo}”).` });
    }
    return null;
  }
}

/**
 * Motivos de encerramento (docs/06-modelo-de-dados.md#encerramento). Listar é de todos (o modal
 * de encerrar precisa); cadastrar/editar: `settings.manage`. Excluir = desativar: o histórico
 * guarda o id e o nome, e o relatório do mês fechado não pode perder a linha.
 */
@Controller('close-reasons')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PermissionsGuard)
class CloseReasonsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.closeReason.findMany({ where: { tenantId: u.tenantId }, orderBy: [{ position: 'asc' }, { name: 'asc' }], select });
  }

  @Post()
  @RequirePermission('settings.manage')
  async create(@CurrentUser() u: AuthUser, @Body() dto: CloseReasonDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Dê um nome ao motivo');
    const total = await this.prisma.closeReason.count({ where: { tenantId: u.tenantId, isActive: true } });
    if (total >= CLOSE_REASONS_MAX) throw new BadRequestException(`Limite de ${CLOSE_REASONS_MAX} motivos ativos`);
    // nome de um motivo desativado: reativa em vez de duplicar (o histórico continua no mesmo id)
    const antigo = await this.prisma.closeReason.findFirst({ where: { tenantId: u.tenantId, name } });
    if (antigo) {
      if (antigo.isActive) throw new ConflictException('Já existe um motivo com esse nome');
      return this.prisma.closeReason.update({ where: { id: antigo.id }, data: { isActive: true, outcome: dto.outcome ?? 'both', ignoreInReports: dto.ignoreInReports ?? false, requiresTag: dto.requiresTag ?? false, ...(dto.color && { color: dto.color }) }, select });
    }
    return this.prisma.closeReason.create({ data: { tenantId: u.tenantId, name, outcome: dto.outcome ?? 'both', ignoreInReports: dto.ignoreInReports ?? false, requiresTag: dto.requiresTag ?? false, position: total, ...(dto.color && { color: dto.color }) }, select });
  }

  @Patch('order')
  @RequirePermission('settings.manage')
  async order(@CurrentUser() u: AuthUser, @Body() dto: OrderDto) {
    await this.prisma.$transaction(dto.ids.map((id, position) => this.prisma.closeReason.updateMany({ where: { id, tenantId: u.tenantId }, data: { position } })));
    return { ok: true };
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateCloseReasonDto) {
    await this.findOrThrow(u.tenantId, id);
    const name = dto.name?.trim();
    if (name === '') throw new BadRequestException('Dê um nome ao motivo');
    return this.prisma.closeReason
      .update({ where: { id }, data: { ...(name && { name }), ...(dto.color && { color: dto.color }), ...(dto.outcome && { outcome: dto.outcome }), ...(dto.isActive !== undefined && { isActive: dto.isActive }), ...(dto.ignoreInReports !== undefined && { ignoreInReports: dto.ignoreInReports }), ...(dto.requiresTag !== undefined && { requiresTag: dto.requiresTag }) }, select })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Já existe um motivo com esse nome');
        throw e;
      });
  }

  /** Desativa (some do encerramento e do filtro de novos); histórico e relatório continuam com o nome. */
  @Delete(':id')
  @RequirePermission('settings.manage')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.findOrThrow(u.tenantId, id);
    await this.prisma.closeReason.update({ where: { id }, data: { isActive: false } });
    return { ok: true };
  }

  private async findOrThrow(tenantId: string, id: string) {
    if (!(await this.prisma.closeReason.findFirst({ where: { id, tenantId }, select: { id: true } }))) throw new NotFoundException('Motivo não encontrado');
  }
}

@Module({ imports: [AuthModule], controllers: [CloseReasonsController], providers: [CloseReasonsService], exports: [CloseReasonsService] })
export class CloseReasonsModule {}
