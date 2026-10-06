import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsObject, IsOptional, IsString, IsUUID, IsInt, MaxLength, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { copyName, flowFromPortable, flowTagNames, flowToPortable, normalizeContent, parsePortableFlowFile, toBundle, uniqueName, type FlowDefinition, type FlowNodeType, type FlowTrigger, type PortableFlow } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';
import { FlowEngineService } from './flow-engine.service';
import { UsageService } from '../billing/usage.service';
import { botPaused } from '../conversations/bot-pause';
import { assertOwnFlowMedia, validateDefinition } from './flow-validation';

class FlowDto {
  @IsString() @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() showInChat?: boolean;
  @IsObject() trigger: FlowTrigger;
  @IsObject() definition: FlowDefinition;
}
class UpdateFlowDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() showInChat?: boolean;
  @IsOptional() @IsObject() trigger?: FlowTrigger;
  @IsOptional() @IsObject() definition?: FlowDefinition;
  /** versão que o editor carregou; diferente da do banco = 409 `flow_version_conflict`. Ausente (interruptor da lista) = sem checagem */
  @IsOptional() @IsInt() @Min(1) version?: number;
}
class IdsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('all', { each: true }) ids: string[];
}
class ActiveDto extends IdsDto {
  @IsBoolean() isActive: boolean;
}
class StartDto {
  @IsUUID() conversationId: string;
  /** robô pausado na conversa: true = o atendente confirmou retomar o robô e iniciar o fluxo */
  @IsOptional() @IsBoolean() resumeBot?: boolean;
}

/** Fluxos de automação — funcionalidade plugável no plano (`features: ['flows']`). */
@Controller('flows')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, FeatureGuard)
@RequireFeature('flows')
export class FlowsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: FlowEngineService,
    private readonly storage: StorageService,
    private readonly usage: UsageService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.flow.findMany({
      where: { tenantId: u.tenantId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true, isActive: true, showInChat: true, trigger: true, updatedAt: true, _count: { select: { runs: true } } },
    });
  }

  /** `mediaUrls`: link assinado (1h) de cada anexo do Conteúdo, para a prévia no editor. */
  @Get(':id')
  async one(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const flow = await this.prisma.flow.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    const def = flow.definition as unknown as FlowDefinition;
    const keys = (def.nodes ?? []).flatMap((n) => (n.type === 'message' ? normalizeContent(n.data).map((it) => it.mediaKey) : []));
    const mediaUrls = Object.fromEntries(keys.filter((k): k is string => !!k && k.startsWith(`media/${u.tenantId}/`)).map((k) => [k, this.storage.signedUrl(k)]));
    return { ...flow, mediaUrls };
  }

  /** Fluxos que conectam a este (bloco "Conectar com outro fluxo") — aviso antes de excluir. */
  @Get(':id/references')
  async references(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.flow.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    const flows = await this.prisma.flow.findMany({ where: { tenantId: u.tenantId, id: { not: id } }, select: { id: true, name: true, definition: true }, orderBy: { name: 'asc' } });
    return flows
      .filter((f) => ((f.definition as unknown as FlowDefinition).nodes ?? []).some((n) => n.type === 'connect_flow' && n.data.flowId === id))
      .map((f) => ({ id: f.id, name: f.name }));
  }

  @Post()
  @RequirePermission('flows.manage')
  async create(@CurrentUser() u: AuthUser, @Body() dto: FlowDto) {
    validateDefinition(dto.definition, { strict: true });
    assertOwnFlowMedia(u.tenantId, dto.definition);
    // `maxFlows` conta fluxos ATIVOS: criar desativado (rascunho) sempre pode
    if (dto.isActive ?? true) await this.usage.assertRoom(u.tenantId, 'maxFlows');
    return this.prisma.flow.create({
      data: {
        tenantId: u.tenantId,
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive ?? true,
        // padrão pelo gatilho: fluxo que dispara sozinho não precisa de atalho manual no chat
        showInChat: dto.showInChat ?? dto.trigger.type === 'manual',
        trigger: dto.trigger as object,
        definition: dto.definition as object,
      },
    });
  }

  @Patch(':id')
  @RequirePermission('flows.manage')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: UpdateFlowDto) {
    const { version, ...dto } = body;
    if (dto.definition) {
      validateDefinition(dto.definition, { strict: true });
      assertOwnFlowMedia(u.tenantId, dto.definition);
    }
    const current = await this.prisma.flow.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    // ativar pela lista não passa pelo editor: o desenho salvo (cópia, importado) precisa estar válido
    if (dto.isActive && !current.isActive && !dto.definition) validateDefinition(current.definition as unknown as FlowDefinition);
    if (dto.isActive && !current.isActive) await this.usage.assertRoom(u.tenantId, 'maxFlows');
    // optimistic locking: só grava se ninguém salvou depois que o editor carregou (renomear faixa
    // de horário também conta — docs/horarios.md). Toda escrita incrementa a versão.
    const saved = await this.prisma.flow.updateMany({
      where: { id, tenantId: u.tenantId, ...(version !== undefined && { version }) },
      data: { ...dto, trigger: dto.trigger as object | undefined, definition: dto.definition as object | undefined, version: { increment: 1 } },
    });
    if (!saved.count) throw new ConflictException({ code: 'flow_version_conflict', message: 'Este fluxo foi alterado por outra pessoa ou pelo sistema. Recarregue para ver a versão atual.' });
    return this.prisma.flow.findUniqueOrThrow({ where: { id } });
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
   * Mantida por compatibilidade; a tela usa a versão em lote.
   */
  @Post(':id/duplicate')
  @RequirePermission('flows.manage')
  async duplicate(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const [flow] = await this.duplicateMany(u.tenantId, [id]);
    return flow;
  }

  /** Duplica vários de uma vez (seleção na listagem). Declarado antes de `:id` por clareza. */
  @Post('duplicate')
  @RequirePermission('flows.manage')
  async duplicateBatch(@CurrentUser() u: AuthUser, @Body() dto: IdsDto) {
    return { flows: await this.duplicateMany(u.tenantId, dto.ids) };
  }

  private async duplicateMany(tenantId: string, ids: string[]) {
    const src = await this.prisma.flow.findMany({ where: { id: { in: ids }, tenantId }, orderBy: { name: 'asc' } });
    if (src.length !== new Set(ids).size) throw new BadRequestException('Fluxo não encontrado.');
    const taken = (await this.prisma.flow.findMany({ where: { tenantId }, select: { name: true } })).map((f) => f.name);
    const created = [];
    for (const f of src) {
      const name = copyName(f.name, taken);
      taken.push(name);
      created.push(await this.prisma.flow.create({
        data: { tenantId, name, description: f.description, isActive: false, showInChat: f.showInChat, trigger: f.trigger as object, definition: f.definition as object },
      }));
    }
    return created;
  }

  /**
   * Ativa/desativa vários (seleção na listagem). Ativar valida o desenho de cada um; os inválidos
   * ficam como estão e voltam em `failed` com o motivo — os demais são alterados.
   */
  @Post('active')
  @RequirePermission('flows.manage')
  async setActiveBatch(@CurrentUser() u: AuthUser, @Body() dto: ActiveDto) {
    const flows = await this.prisma.flow.findMany({ where: { id: { in: dto.ids }, tenantId: u.tenantId }, select: { id: true, name: true, isActive: true, definition: true } });
    if (flows.length !== new Set(dto.ids).size) throw new BadRequestException('Fluxo não encontrado.');
    const ok: string[] = [];
    const failed: { id: string; name: string; reason: string }[] = [];
    for (const f of flows) {
      if (f.isActive === dto.isActive) { ok.push(f.id); continue; }
      if (dto.isActive) {
        try {
          validateDefinition(f.definition as unknown as FlowDefinition);
        } catch (e) {
          failed.push({ id: f.id, name: f.name, reason: e instanceof Error ? e.message : 'desenho inválido' });
          continue;
        }
      }
      ok.push(f.id);
    }
    // só os que vão de fato ligar contam para `maxFlows`; o lote inteiro é recusado se não couber
    if (dto.isActive) await this.usage.assertRoom(u.tenantId, 'maxFlows', ok.filter((id) => !flows.find((f) => f.id === id)!.isActive).length);
    if (ok.length) await this.prisma.flow.updateMany({ where: { id: { in: ok }, tenantId: u.tenantId }, data: { isActive: dto.isActive, version: { increment: 1 } } });
    return { updated: ok.length, failed };
  }

  /** Arquivo para levar o fluxo a OUTRO cliente. Ver `scrubFlowDefinition` (shared/portable.ts) para o que não viaja. */
  @Get(':id/export')
  @RequirePermission('flows.manage')
  async export(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const { items, warnings } = await this.exportMany(u.tenantId, [id]);
    return { portable: items[0], warnings };
  }

  /** Vários fluxos num arquivo só: a lista de itens no mesmo formato da exportação individual. */
  @Post('export')
  @RequirePermission('flows.manage')
  async exportBatch(@CurrentUser() u: AuthUser, @Body() dto: IdsDto) {
    const { items, warnings } = await this.exportMany(u.tenantId, dto.ids);
    return { bundle: toBundle('flow', items), warnings };
  }

  private async exportMany(tenantId: string, ids: string[]) {
    const flows = await this.prisma.flow.findMany({ where: { id: { in: ids }, tenantId }, orderBy: { name: 'asc' } });
    if (flows.length !== new Set(ids).size) throw new BadRequestException('Fluxo não encontrado.');
    const tags = await this.prisma.tag.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const tagNameById = Object.fromEntries(tags.map((t) => [t.id, t.name]));
    const flowNameById = Object.fromEntries((await this.prisma.flow.findMany({ where: { tenantId }, select: { id: true, name: true } })).map((f) => [f.id, f.name]));
    const items: PortableFlow[] = [];
    const warnings = new Set<string>();
    for (const flow of flows) {
      const out = flowToPortable({ name: flow.name, description: flow.description, trigger: flow.trigger as unknown as FlowTrigger, definition: flow.definition as unknown as FlowDefinition }, { tagNameById, flowNameById });
      items.push(out.portable);
      // num lote, o aviso diz de qual fluxo é
      out.warnings.forEach((w) => warnings.add(flows.length > 1 ? `${flow.name}: ${w}` : w));
    }
    return { items, warnings: [...warnings] };
  }

  /**
   * Traz fluxos exportados para este cliente — arquivo individual ou lote. As etiquetas
   * citadas são criadas se faltarem (sem isso o fluxo chegaria mudo), os nós ganham ids novos e
   * nome repetido vira "(cópia)". Tudo ou nada: um item inválido recusa o arquivo inteiro antes
   * de criar qualquer fluxo.
   */
  @Post('import')
  @RequirePermission('flows.manage')
  async import(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    let items: PortableFlow[];
    try {
      items = parsePortableFlowFile((body as { portable?: unknown })?.portable ?? body);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Arquivo inválido.');
    }

    const names = [...new Set(items.flatMap((p) => flowTagNames(p.definition)))];
    if (names.length) {
      await this.prisma.tag.createMany({ data: names.map((name) => ({ tenantId: u.tenantId, name })), skipDuplicates: true });
    }
    const tags = await this.prisma.tag.findMany({ where: { tenantId: u.tenantId, name: { in: names } }, select: { id: true, name: true } });
    const tagIdByName = Object.fromEntries(tags.map((t) => [t.name, t.id]));

    const newId = (type: FlowNodeType) => `${type}-${randomUUID().slice(0, 6)}`;
    const built = items.map((p) => flowFromPortable(p, tagIdByName, newId));
    built.forEach((b) => {
      validateDefinition(b.definition);
      // arquivo editado à mão pode apontar para anexo de outro cliente
      assertOwnFlowMedia(u.tenantId, b.definition);
    });

    const taken = (await this.prisma.flow.findMany({ where: { tenantId: u.tenantId }, select: { name: true } })).map((f) => f.name);
    const flows = [];
    const warnings = new Set<string>();
    for (const b of built) {
      const name = uniqueName(b.name, taken);
      taken.push(name);
      flows.push(await this.prisma.flow.create({
        data: { tenantId: u.tenantId, name, description: b.description, isActive: false, trigger: b.trigger as object, definition: b.definition as object },
      }));
      b.warnings.forEach((w) => warnings.add(built.length > 1 ? `${name}: ${w}` : w));
    }
    return { flows, flow: flows[0], warnings: [...warnings] };
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
    const conv = await this.prisma.conversation.findFirstOrThrow({ where: { id: dto.conversationId, tenantId: u.tenantId } });
    if (botPaused(conv)) {
      // decisão da tarefa 1.5: a tela pede confirmação (409 `bot_paused`) e, confirmado, retoma o robô e inicia
      if (!dto.resumeBot) throw new ConflictException({ code: 'bot_paused', message: 'Os fluxos estão pausados nesta conversa. Retomar e iniciar o fluxo?' });
      await this.engine.resumeBot(u.tenantId, conv.id, u);
    }
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

  /** Cancelar (menu de pausa): encerra o fluxo, pausado ou não, e libera a automação da conversa. */
  @Post(':id/flow/cancel')
  async cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.conversation.findFirstOrThrow({ where: { id, tenantId: u.tenantId } });
    return this.engine.cancelFlow(u.tenantId, id, u);
  }

  /** Fluxo da conversa: rodando, esperando ou pausado (`paused`, com `pausedFrom`). */
  @Get(':id/flow')
  async active(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const run = await this.prisma.flowRun.findFirst({ where: { conversationId: id, tenantId: u.tenantId, status: { in: ['running', 'waiting', 'paused'] } }, include: { flow: { select: { id: true, name: true } } } });
    return run ? { id: run.id, status: run.status, pausedFrom: run.pausedFrom, currentNodeId: run.currentNodeId, flow: run.flow, startedAt: run.startedAt, waitUntil: run.waitUntil } : null;
  }
}
