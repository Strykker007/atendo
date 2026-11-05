import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { AGENT_DEFAULT_MAX_REPLIES, AGENT_MAX_STAGES, AGENT_TONES, AGENT_TOOL_KEYS, type AgentStage, type AgentToolTargets, type AgentTurn, type AiAgentConfig, type AgentTone } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';
import { AiService } from './ai.service';
import { agentSystemPrompt, parseAgentReply, stageOf, type AgentCatalog } from './agent-prompt';
import { toMessages, type HistoryItem } from './prompts';

class AgentDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) persona?: string;
  @IsOptional() @IsIn(Object.keys(AGENT_TONES)) tone?: AgentTone;
  @IsOptional() @IsString() @MaxLength(4000) rules?: string;
  @IsOptional() @IsString() @MaxLength(20000) knowledge?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(AGENT_MAX_STAGES) stages?: AgentStage[];
  @IsOptional() @IsObject() targets?: AgentToolTargets;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxReplies?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class SimMessage {
  @IsIn(['contact', 'agent']) from: 'contact' | 'agent';
  @IsString() @MaxLength(2000) text: string;
}
class SimulateDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => SimMessage) messages: SimMessage[];
  @IsOptional() @IsString() @MaxLength(100) stageId?: string;
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Normaliza e valida o roteiro. Etapas com id único (gera quando falta), destino de transição
 * só para etapa que existe (e nunca ela mesma), ferramenta só das conhecidas.
 */
export function cleanStages(raw: unknown): AgentStage[] {
  if (!Array.isArray(raw) || !raw.length) throw new BadRequestException('O agente precisa de pelo menos uma etapa.');
  if (raw.length > AGENT_MAX_STAGES) throw new BadRequestException(`No máximo ${AGENT_MAX_STAGES} etapas.`);
  const seen = new Set<string>();
  const stages = raw.map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>;
    let id = clip(o.id, 60) || randomUUID().slice(0, 8);
    if (seen.has(id)) id = `${id}-${i}`;
    seen.add(id);
    const name = clip(o.name, 60) || `Etapa ${i + 1}`;
    const goal = clip(o.goal, 3000);
    if (!goal) throw new BadRequestException(`A etapa "${name}" precisa dizer o que a IA faz nela.`);
    const tools = Array.isArray(o.tools) ? [...new Set(o.tools.filter((t): t is AgentStage['tools'][number] => AGENT_TOOL_KEYS.includes(t as never)))] : [];
    return { id, name, goal, tools, transitions: Array.isArray(o.transitions) ? o.transitions : [] } as AgentStage;
  });
  const ids = new Set(stages.map((s) => s.id));
  for (const s of stages) {
    s.transitions = (s.transitions as unknown[])
      .map((t) => { const o = (t ?? {}) as Record<string, unknown>; return { to: clip(o.to, 60), when: clip(o.when, 500) }; })
      .filter((t) => t.to !== s.id && ids.has(t.to) && t.when)
      .slice(0, 6);
  }
  return stages;
}

const agentSelect = { id: true, name: true, persona: true, tone: true, rules: true, knowledge: true, stages: true, targets: true, maxReplies: true, isActive: true, createdAt: true, updatedAt: true } as const;

/** Agentes de IA com etapas (docs/agente-ia.md): cadastro, catálogo de alvos e a rodada com o modelo. */
@Injectable()
export class AiAgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  list(tenantId: string) {
    return this.prisma.aiAgent.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, select: agentSelect });
  }

  async get(tenantId: string, id: string) {
    const a = await this.prisma.aiAgent.findFirst({ where: { id, tenantId }, select: agentSelect });
    if (!a) throw new NotFoundException('Agente não encontrado.');
    return a;
  }

  /** Nomes dos alvos do cliente — o editor escolhe por aqui e a IA recebe só os liberados. */
  async catalog(tenantId: string): Promise<AgentCatalog> {
    const [departments, tags, closeReasons, attrs] = await Promise.all([
      this.prisma.department.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.tag.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.closeReason.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.contactAttribute.findMany({ where: { tenantId }, distinct: ['label'], orderBy: { label: 'asc' }, select: { label: true }, take: 100 }),
    ]);
    return { departments, tags, closeReasons, customFields: attrs.map((a) => a.label) };
  }

  /** Alvos só do próprio cliente: id de outro tenant some aqui, não chega à IA. */
  private async cleanTargets(tenantId: string, raw: unknown): Promise<AgentToolTargets> {
    const o = (raw ?? {}) as Record<string, unknown>;
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : []);
    const cat = await this.catalog(tenantId);
    const keep = (list: { id: string }[], v: unknown) => ids(v).filter((id) => list.some((x) => x.id === id));
    return {
      departmentIds: keep(cat.departments, o.departmentIds),
      tagIds: keep(cat.tags, o.tagIds),
      closeReasonIds: keep(cat.closeReasons, o.closeReasonIds),
      contactFields: ids(o.contactFields).filter((k) => ['name', 'email', 'address', 'note1', 'note2'].includes(k) || (k.startsWith('attribute:') && k.length > 10)),
    };
  }

  private async data(tenantId: string, dto: AgentDto) {
    return {
      ...(dto.name !== undefined && { name: clip(dto.name, 80) || 'Agente' }),
      ...(dto.persona !== undefined && { persona: clip(dto.persona, 2000) }),
      ...(dto.tone !== undefined && { tone: dto.tone }),
      ...(dto.rules !== undefined && { rules: clip(dto.rules, 4000) }),
      ...(dto.knowledge !== undefined && { knowledge: clip(dto.knowledge, 20000) }),
      ...(dto.stages !== undefined && { stages: cleanStages(dto.stages) as never }),
      ...(dto.targets !== undefined && { targets: (await this.cleanTargets(tenantId, dto.targets)) as never }),
      ...(dto.maxReplies !== undefined && { maxReplies: dto.maxReplies }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
  }

  async create(tenantId: string, dto: AgentDto) {
    const stages = dto.stages?.length ? dto.stages : [{ id: 'inicio', name: 'Atendimento', goal: 'Entenda o que o contato precisa e ajude com base na base de conhecimento.', transitions: [], tools: [] }];
    return this.prisma.aiAgent.create({
      data: { tenantId, maxReplies: AGENT_DEFAULT_MAX_REPLIES, ...(await this.data(tenantId, { ...dto, stages })), name: clip(dto.name, 80) || 'Novo agente' },
      select: agentSelect,
    });
  }

  async update(tenantId: string, id: string, dto: AgentDto) {
    await this.get(tenantId, id);
    return this.prisma.aiAgent.update({ where: { id }, data: await this.data(tenantId, dto), select: agentSelect });
  }

  async remove(tenantId: string, id: string) {
    const { count } = await this.prisma.aiAgent.deleteMany({ where: { id, tenantId } });
    if (!count) throw new NotFoundException('Agente não encontrado.');
    return { ok: true };
  }

  /** Config do agente lida do banco, no formato do shared. */
  async config(tenantId: string, id: string): Promise<AiAgentConfig> {
    const a = await this.get(tenantId, id);
    return { ...a, tone: (a.tone in AGENT_TONES ? a.tone : 'friendly') as AgentTone, stages: a.stages as unknown as AgentStage[], targets: (a.targets ?? {}) as AgentToolTargets };
  }

  /**
   * Uma rodada: monta o prompt da etapa, chama o modelo (quota, teto e ledger no `AiService.run`)
   * e confere a resposta. Lança se a IA falhar ou devolver algo ilegível — quem chama entrega
   * para humano.
   */
  async turn(input: { tenantId: string; agent: AiAgentConfig; stageId?: string | null; history: HistoryItem[]; contactName?: string | null; conversationId?: string; userId?: string }): Promise<AgentTurn & { catalog: AgentCatalog }> {
    const stage = stageOf(input.agent, input.stageId);
    if (!stage) throw new BadRequestException('O agente não tem etapas.');
    const [tenant, catalog] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: input.tenantId }, select: { name: true } }),
      this.catalog(input.tenantId),
    ]);
    const messages = toMessages(input.history);
    if (!messages.length) throw new BadRequestException('Ainda não há mensagem do contato para responder.');
    const raw = await this.ai.run({
      tenantId: input.tenantId,
      kind: 'flow_agent',
      conversationId: input.conversationId,
      userId: input.userId,
      system: agentSystemPrompt({ agent: input.agent, stage, businessName: tenant.name, catalog, contactName: input.contactName }),
      messages,
      maxTokens: 600,
      temperature: 0.3,
    });
    const parsed = parseAgentReply(raw, { agent: input.agent, stage, catalog });
    if (!parsed) throw new BadRequestException('A IA devolveu uma resposta que não deu para entender.');
    return { ...parsed, catalog };
  }
}

/**
 * Tela Agentes de IA. Mesma permissão de quem monta fluxos (é lá que o agente entra) e mesma
 * feature do bloco IA nos fluxos.
 */
@Controller('ai/agents')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard, FeatureGuard)
@RequirePermission('flows.manage')
@RequireFeature('ai_flows')
export class AiAgentsController {
  constructor(private readonly agents: AiAgentsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.agents.list(u.tenantId);
  }

  @Get('catalog')
  catalog(@CurrentUser() u: AuthUser) {
    return this.agents.catalog(u.tenantId);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.agents.get(u.tenantId, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: AgentDto) {
    return this.agents.create(u.tenantId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AgentDto) {
    return this.agents.update(u.tenantId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.agents.remove(u.tenantId, id);
  }

  /**
   * Simulador: conversa de mentira com o agente salvo. Mostra a resposta, a etapa e as ações que
   * ELE PEDIRIA — nada é executado e nenhuma mensagem sai. Conta como interação de IA.
   */
  @Post(':id/simulate')
  async simulate(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SimulateDto) {
    const agent = await this.agents.config(u.tenantId, id);
    const history: HistoryItem[] = dto.messages.map((m) => ({ direction: m.from === 'contact' ? 'in' : 'out', text: m.text }));
    const { catalog: _c, ...turn } = await this.agents.turn({ tenantId: u.tenantId, agent, stageId: dto.stageId, history, userId: u.id });
    void _c;
    return turn;
  }
}
