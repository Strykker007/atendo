import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { FlowDefinition, FlowTrigger } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';
import { FlowEngineService } from './flow-engine.service';
import { validateDefinition } from './flow-validation';
import { copyName, fromPortable, parsePortable, tagNamesOf, toPortable } from './portable';

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
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, FeatureGuard)
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
  @RequirePermission('flows.manage')
  create(@CurrentUser() u: AuthUser, @Body() dto: FlowDto) {
    validateDefinition(dto.definition);
    return this.prisma.flow.create({ data: { tenantId: u.tenantId, name: dto.name, description: dto.description, isActive: dto.isActive ?? true, trigger: dto.trigger as object, definition: dto.definition as object } });
  }

  @Patch(':id')
  @RequirePermission('flows.manage')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Partial<FlowDto>) {
    if (dto.definition) validateDefinition(dto.definition);
    await this.prisma.flow.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    return this.prisma.flow.update({ where: { id }, data: { ...dto, trigger: dto.trigger as object | undefined, definition: dto.definition as object | undefined } });
  }

  @Delete(':id')
  @RequirePermission('flows.manage')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.flow.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    await this.prisma.flow.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Cópia dentro do MESMO cliente: nada precisa ser traduzido, as etiquetas e os atendentes
   * referenciados continuam valendo. Nasce desativada para não começar a responder sozinha.
   */
  @Post(':id/duplicate')
  @RequirePermission('flows.manage')
  async duplicate(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const src = await this.prisma.flow.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    const taken = await this.prisma.flow.findMany({ where: { tenantId: u.tenantId }, select: { name: true } });
    return this.prisma.flow.create({
      data: {
        tenantId: u.tenantId,
        name: copyName(src.name, taken.map((f) => f.name)),
        description: src.description,
        isActive: false,
        trigger: src.trigger as object,
        definition: src.definition as object,
      },
    });
  }

  /** Arquivo para levar o fluxo a OUTRO cliente. Ver `portable.ts` para o que não viaja. */
  @Get(':id/export')
  @RequirePermission('flows.manage')
  async export(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const flow = await this.prisma.flow.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    const tags = await this.prisma.tag.findMany({ where: { tenantId: u.tenantId }, select: { id: true, name: true } });
    const { portable, warnings } = toPortable(
      { name: flow.name, description: flow.description, trigger: flow.trigger as unknown as FlowTrigger, definition: flow.definition as unknown as FlowDefinition },
      Object.fromEntries(tags.map((t) => [t.id, t.name])),
    );
    return { portable, warnings };
  }

  /**
   * Traz um fluxo exportado para este cliente. As etiquetas citadas são criadas se faltarem
   * — sem isso o fluxo chegaria mudo, com os blocos de etiqueta vazios.
   */
  @Post('import')
  @RequirePermission('flows.manage')
  async import(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    let portable;
    try {
      portable = parsePortable((body as { portable?: unknown })?.portable ?? body);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Arquivo inválido.');
    }

    const names = tagNamesOf(portable);
    if (names.length) {
      await this.prisma.tag.createMany({ data: names.map((name) => ({ tenantId: u.tenantId, name })), skipDuplicates: true });
    }
    const tags = await this.prisma.tag.findMany({ where: { tenantId: u.tenantId, name: { in: names } }, select: { id: true, name: true } });

    const built = fromPortable(portable, Object.fromEntries(tags.map((t) => [t.name, t.id])));
    validateDefinition(built.definition);

    const taken = await this.prisma.flow.findMany({ where: { tenantId: u.tenantId }, select: { name: true } });
    const names_ = taken.map((f) => f.name);
    const flow = await this.prisma.flow.create({
      data: {
        tenantId: u.tenantId,
        name: names_.includes(built.name) ? copyName(built.name, names_) : built.name,
        description: built.description,
        isActive: false,
        trigger: built.trigger as object,
        definition: built.definition as object,
      },
    });
    return { flow, warnings: built.warnings };
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
