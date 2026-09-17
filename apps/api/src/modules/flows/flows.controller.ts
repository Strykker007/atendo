import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { FlowDefinition, FlowTrigger } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';
import { FlowEngineService } from './flow-engine.service';
import { validateDefinition } from './flow-validation';

class FlowDto {
  @IsString() @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsObject() trigger: FlowTrigger;
  @IsObject() definition: FlowDefinition;
}
class StartDto {
  @IsUUID() conversationId: string;
}

/** Fluxos de automação — funcionalidade plugável no plano (`features: ['flows']`). */
@Controller('flows')
@UseGuards(JwtAuthGuard, RolesGuard, FeatureGuard)
@RequireFeature('flows')
export class FlowsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: FlowEngineService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.flow.findMany({
      where: { tenantId: u.tenantId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true, isActive: true, trigger: true, updatedAt: true, _count: { select: { runs: true } } },
    });
  }

  @Get(':id')
  one(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.prisma.flow.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
  }

  @Post()
  @Roles('tenant_admin', 'manager', 'super_admin')
  create(@CurrentUser() u: AuthUser, @Body() dto: FlowDto) {
    validateDefinition(dto.definition);
    return this.prisma.flow.create({ data: { tenantId: u.tenantId, name: dto.name, description: dto.description, isActive: dto.isActive ?? true, trigger: dto.trigger as object, definition: dto.definition as object } });
  }

  @Patch(':id')
  @Roles('tenant_admin', 'manager', 'super_admin')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Partial<FlowDto>) {
    if (dto.definition) validateDefinition(dto.definition);
    await this.prisma.flow.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    return this.prisma.flow.update({ where: { id }, data: { ...dto, trigger: dto.trigger as object | undefined, definition: dto.definition as object | undefined } });
  }

  @Delete(':id')
  @Roles('tenant_admin', 'manager', 'super_admin')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.flow.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    await this.prisma.flow.delete({ where: { id } });
    return { ok: true };
  }

  /** Estatísticas de execução: quantas rodaram, terminaram, falharam; últimas execuções. */
  @Get(':id/runs')
  async runs(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.flow.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    const [byStatus, recent] = await Promise.all([
      this.prisma.flowRun.groupBy({ by: ['status'], where: { flowId: id }, _count: { _all: true } }),
      this.prisma.flowRun.findMany({ where: { flowId: id }, orderBy: { startedAt: 'desc' }, take: 20, include: { conversation: { include: { contact: { select: { name: true, phone: true } } } } } }),
    ]);
    return { byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])), recent: recent.map((r) => ({ id: r.id, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt, error: r.error, contact: r.conversation.contact, conversationId: r.conversationId })) };
  }

  /** Disparo manual pelo atendente (painel do chat). */
  @Post(':id/start')
  async start(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: StartDto) {
    await this.prisma.flow.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    await this.prisma.conversation.findFirstOrThrow({ where: { id: dto.conversationId, tenantId: u.tenantId } });
    return this.engine.start(id, dto.conversationId, u.id);
  }
}

/** Parar o fluxo da conversa — fora do guard de feature (quem tem run ativo precisa poder parar). */
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class FlowStopController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: FlowEngineService,
  ) {}

  @Post(':id/flow/stop')
  async stop(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.conversation.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    const run = await this.engine.stop(id);
    return { stopped: !!run };
  }

  @Get(':id/flow')
  async active(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const run = await this.prisma.flowRun.findFirst({ where: { conversationId: id, tenantId: u.tenantId, status: { in: ['running', 'waiting'] } }, include: { flow: { select: { id: true, name: true } } } });
    return run ? { id: run.id, status: run.status, currentNodeId: run.currentNodeId, flow: run.flow, startedAt: run.startedAt, waitUntil: run.waitUntil } : null;
  }
}
