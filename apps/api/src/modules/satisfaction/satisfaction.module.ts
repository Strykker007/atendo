import { BadRequestException, Body, Controller, Delete, Get, Module, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { z } from 'zod';
import { SURVEY_EXTRA_QUESTIONS_MAX, SURVEY_SATISFIED_FROM, SURVEY_SCALE_MAX, SURVEY_SCALES, type SurveyScale } from '@atendo/shared';
import { reportScope } from '../../common/reports/report-scope';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ReportLoadService, assertReportRange } from '../../common/reports/report-load.service';
import { BillingModule } from '../billing/billing.module';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';

export const SURVEYS_MAX = 20;

class ExtraQuestionDto {
  @IsString() @MaxLength(40) id: string;
  @IsString() @MaxLength(1000) text: string;
  @IsIn([...SURVEY_SCALES]) scale: SurveyScale;
}

class SurveyDto {
  @IsString() @MaxLength(80) name: string;
  @IsIn([...SURVEY_SCALES]) scale: SurveyScale;
  @IsString() @MaxLength(1000) question: string;
  @IsOptional() @IsBoolean() allowDecline?: boolean;
  /** vira botão na CSAT de 3 pontos: o WhatsApp corta em 20 caracteres */
  @IsOptional() @IsString() @MaxLength(20) declineLabel?: string;
  @IsOptional() @IsBoolean() askComment?: boolean;
  /** até 2 além da principal; cada uma só sai depois da resposta anterior */
  @IsOptional() @IsArray() @ArrayMaxSize(SURVEY_EXTRA_QUESTIONS_MAX) @ValidateNested({ each: true }) @Type(() => ExtraQuestionDto) extraQuestions?: ExtraQuestionDto[];
  @IsOptional() @IsString() @MaxLength(1000) commentPrompt?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) thanksMessage?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) declinedMessage?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(168) expiresHours?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
class UpdateSurveyDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsIn([...SURVEY_SCALES]) scale?: SurveyScale;
  @IsOptional() @IsString() @MaxLength(1000) question?: string;
  @IsOptional() @IsBoolean() allowDecline?: boolean;
  @IsOptional() @IsString() @MaxLength(20) declineLabel?: string;
  @IsOptional() @IsBoolean() askComment?: boolean;
  /** até 2 além da principal; cada uma só sai depois da resposta anterior */
  @IsOptional() @IsArray() @ArrayMaxSize(SURVEY_EXTRA_QUESTIONS_MAX) @ValidateNested({ each: true }) @Type(() => ExtraQuestionDto) extraQuestions?: ExtraQuestionDto[];
  @IsOptional() @IsString() @MaxLength(1000) commentPrompt?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) thanksMessage?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) declinedMessage?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(168) expiresHours?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

const select = { id: true, name: true, scale: true, question: true, allowDecline: true, declineLabel: true, askComment: true, extraQuestions: true, commentPrompt: true, thanksMessage: true, declinedMessage: true, expiresHours: true, isDefault: true, isActive: true, createdAt: true } as const;
/** sem texto = descartada; id repetido não pode (é a chave do relatório) */
function limparExtras(list: ExtraQuestionDto[] | undefined) {
  const out = (list ?? []).map((q) => ({ id: q.id.trim(), text: q.text.trim(), scale: q.scale })).filter((q) => q.text && q.id);
  if (new Set(out.map((q) => q.id)).size !== out.length) throw new BadRequestException('Perguntas adicionais com id repetido');
  return out;
}
const vazioViraNulo = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);

/**
 * Pesquisas de satisfação (docs/pesquisa-de-satisfacao.md). Listar é de todos (o modal de
 * encerrar precisa); criar/editar: `settings.manage`. Excluir = desativar: as respostas guardam
 * o id e o relatório do mês fechado não pode perder a linha.
 */
@Controller('satisfaction-surveys')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PermissionsGuard, FeatureGuard)
@RequireFeature('satisfaction_surveys')
class SatisfactionSurveysController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.satisfactionSurvey.findMany({ where: { tenantId: u.tenantId }, orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }], select });
  }

  @Post()
  @RequirePermission('settings.manage')
  async create(@CurrentUser() u: AuthUser, @Body() dto: SurveyDto) {
    const name = dto.name.trim();
    const question = dto.question.trim();
    if (!name) throw new BadRequestException('Dê um nome à pesquisa');
    if (!question) throw new BadRequestException('Escreva a pergunta da pesquisa');
    if ((await this.prisma.satisfactionSurvey.count({ where: { tenantId: u.tenantId, isActive: true } })) >= SURVEYS_MAX) throw new BadRequestException(`Limite de ${SURVEYS_MAX} pesquisas ativas`);
    return this.prisma.$transaction(async (tx) => {
      // a primeira pesquisa já nasce padrão: quem cria uma quer que ela saia
      const primeira = !(await tx.satisfactionSurvey.count({ where: { tenantId: u.tenantId, isActive: true } }));
      const isDefault = dto.isDefault ?? primeira;
      if (isDefault) await tx.satisfactionSurvey.updateMany({ where: { tenantId: u.tenantId }, data: { isDefault: false } });
      return tx.satisfactionSurvey.create({
        data: {
          tenantId: u.tenantId, name, scale: dto.scale, question,
          allowDecline: dto.allowDecline ?? true,
          declineLabel: dto.declineLabel?.trim() || 'Não responder',
          askComment: dto.askComment ?? true,
          extraQuestions: limparExtras(dto.extraQuestions) as unknown as Prisma.InputJsonValue,
          commentPrompt: vazioViraNulo(dto.commentPrompt),
          thanksMessage: vazioViraNulo(dto.thanksMessage),
          declinedMessage: vazioViraNulo(dto.declinedMessage),
          expiresHours: dto.expiresHours ?? 24,
          isDefault,
        },
        select,
      });
    });
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateSurveyDto) {
    await this.findOrThrow(u.tenantId, id);
    if (dto.name !== undefined && !dto.name.trim()) throw new BadRequestException('Dê um nome à pesquisa');
    if (dto.question !== undefined && !dto.question.trim()) throw new BadRequestException('Escreva a pergunta da pesquisa');
    const data: Prisma.SatisfactionSurveyUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.scale && { scale: dto.scale }),
      ...(dto.question !== undefined && { question: dto.question.trim() }),
      ...(dto.allowDecline !== undefined && { allowDecline: dto.allowDecline }),
      ...(dto.declineLabel !== undefined && { declineLabel: dto.declineLabel.trim() || 'Não responder' }),
      ...(dto.askComment !== undefined && { askComment: dto.askComment }),
      ...(dto.extraQuestions !== undefined && { extraQuestions: limparExtras(dto.extraQuestions) as unknown as Prisma.InputJsonValue }),
      ...(dto.commentPrompt !== undefined && { commentPrompt: vazioViraNulo(dto.commentPrompt) }),
      ...(dto.thanksMessage !== undefined && { thanksMessage: vazioViraNulo(dto.thanksMessage) }),
      ...(dto.declinedMessage !== undefined && { declinedMessage: vazioViraNulo(dto.declinedMessage) }),
      ...(dto.expiresHours !== undefined && { expiresHours: dto.expiresHours }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      // desativada não pode ser a padrão
      ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
      ...(dto.isActive === false && { isDefault: false }),
    };
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault && dto.isActive !== false) await tx.satisfactionSurvey.updateMany({ where: { tenantId: u.tenantId, id: { not: id } }, data: { isDefault: false } });
      return tx.satisfactionSurvey.update({ where: { id }, data, select });
    });
  }

  /** Desativa: some do encerramento; respostas e relatório continuam. */
  @Delete(':id')
  @RequirePermission('settings.manage')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.findOrThrow(u.tenantId, id);
    await this.prisma.satisfactionSurvey.update({ where: { id }, data: { isActive: false, isDefault: false } });
    return { ok: true };
  }

  private async findOrThrow(tenantId: string, id: string) {
    if (!(await this.prisma.satisfactionSurvey.findFirst({ where: { id, tenantId }, select: { id: true } }))) throw new NotFoundException('Pesquisa não encontrada');
  }
}

const ReportQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** escalas diferentes não se misturam numa média: ausente = a mais respondida no período */
  scale: z.enum(SURVEY_SCALES).optional(),
  surveyId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  /** filtros da lista de comentários */
  scoreMin: z.coerce.number().int().min(1).max(10).optional(),
  scoreMax: z.coerce.number().int().min(1).max(10).optional(),
  onlyComments: z.enum(['0', '1']).optional().transform((v) => v !== '0'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

type Linha = { status: string; score: number | null; n: number };

/** Indicadores de um conjunto de respostas (equipe inteira ou um consultor). */
function indicadores(linhas: Linha[], scale: SurveyScale, aguardando = 0) {
  let sent = 0, answered = 0, declined = 0, soma = 0, satisfeitos = 0, promotores = 0, detratores = 0;
  const dist = new Map<number, number>();
  for (const l of linhas) {
    sent += l.n;
    if (l.status === 'declined') declined += l.n;
    if (l.score != null) {
      answered += l.n;
      soma += l.score * l.n;
      dist.set(l.score, (dist.get(l.score) ?? 0) + l.n);
      if (l.score >= SURVEY_SATISFIED_FROM[scale]) satisfeitos += l.n;
      if (l.score >= 9) promotores += l.n;
      if (l.score <= 6) detratores += l.n;
    }
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    sent,
    answered,
    declined,
    waiting: aguardando,
    noResponse: Math.max(0, sent - answered - declined - aguardando),
    responseRate: pct(answered, sent),
    declineRate: pct(declined, sent),
    avg: answered ? Math.round((soma / answered) * 100) / 100 : null,
    satisfiedPct: answered ? pct(satisfeitos, answered) : null,
    /** só na escala de 10: % promotores (9–10) − % detratores (1–6) */
    nps: scale === 'scale_10' && answered ? Math.round(((promotores - detratores) / answered) * 100) : null,
    distribution: Array.from({ length: SURVEY_SCALE_MAX[scale] }, (_, i) => ({ score: i + 1, count: dist.get(i + 1) ?? 0 })),
  };
}

/**
 * Relatório de satisfação (docs/pesquisa-de-satisfacao.md#relatório). Base: pesquisas ENVIADAS
 * no período (as que falharam no envio ficam fora — o cliente nunca as viu). O consultor é o
 * congelado na resposta, não o dono atual da conversa.
 */
@Controller('reports/satisfaction')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard, FeatureGuard)
@RequireFeature('satisfaction_surveys')
@RequirePermission('reports.view')
class SatisfactionReportController {
  constructor(private readonly prisma: PrismaService, private readonly load: ReportLoadService) {}

  @Get()
  async report(@CurrentUser() u: AuthUser, @Query() q: Record<string, string | undefined>) {
    const f = ReportQuery.parse(q);
    const to = f.to ?? new Date(Date.now() + 86_400_000);
    const from = f.from ?? new Date(Date.now() - 29 * 86_400_000);
    assertReportRange(from, to);
    // cache curto: 30 s, porque a lista de feedbacks é o que a pessoa fica olhando chegar
    // empresa selecionada no painel (e números da pessoa): só respostas das conversas desses números
    const nums = await reportScope(this.prisma, u);
    return this.load.cached(ReportLoadService.key(u.tenantId, 'satisfaction', { ...f, from, to, nums: nums?.join(',') }), () => this.data(u.tenantId, f, from, to, nums), 30);
  }

  private async data(t: string, f: z.infer<typeof ReportQuery>, from: Date, to: Date, nums?: string[]) {
    const escopo: Prisma.SurveyResponseWhereInput = nums ? { conversation: { numberId: { in: nums } } } : {};
    const periodo: Prisma.SurveyResponseWhereInput = { tenantId: t, sentAt: { gte: from, lt: to }, status: { not: 'failed' }, ...(f.surveyId && { surveyId: f.surveyId }), ...escopo };

    const porEscala = await this.load.run(() => this.prisma.surveyResponse.groupBy({ by: ['scale'], where: periodo, _count: { _all: true } }));
    let scale = f.scale;
    if (!scale) {
      const mais = [...porEscala].sort((a, b) => b._count._all - a._count._all)[0]?.scale;
      const padrao = mais ? null : await this.load.run(() => this.prisma.satisfactionSurvey.findFirst({ where: { tenantId: t, isDefault: true }, select: { scale: true } }));
      scale = ((mais ?? padrao?.scale ?? 'scale_5') as SurveyScale);
    }
    const base: Prisma.SurveyResponseWhereInput = { ...periodo, scale };
    const doFiltro: Prisma.SurveyResponseWhereInput = { ...base, ...(f.agentId && { agentId: f.agentId }) };
    const aguardandoWhere: Prisma.SurveyResponseWhereInput = { status: { in: ['pending', 'commenting'] }, score: null, expiresAt: { gt: new Date() } };

    const lista: Prisma.SurveyResponseWhereInput = {
      ...doFiltro,
      score: { not: null, ...(f.scoreMin && { gte: f.scoreMin }), ...(f.scoreMax && { lte: f.scoreMax }) },
      ...(f.onlyComments && { comment: { not: null } }),
    };
    const [totais, aguardando, porConsultor, aguardandoPorConsultor, total, rows, failed] = await this.load.all([
      () => this.prisma.surveyResponse.groupBy({ by: ['status', 'score'], where: doFiltro, _count: { _all: true } }),
      () => this.prisma.surveyResponse.count({ where: { ...doFiltro, ...aguardandoWhere } }),
      () => this.prisma.surveyResponse.groupBy({ by: ['agentId', 'status', 'score'], where: base, _count: { _all: true } }),
      () => this.prisma.surveyResponse.groupBy({ by: ['agentId'], where: { ...base, ...aguardandoWhere }, _count: { _all: true } }),
      () => this.prisma.surveyResponse.count({ where: lista }),
      () => this.prisma.surveyResponse.findMany({
        where: lista,
        orderBy: { answeredAt: 'desc' },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
        select: { id: true, score: true, comment: true, answeredAt: true, sentAt: true, agentId: true, agentName: true, conversationId: true, survey: { select: { name: true } }, conversation: { select: { contact: { select: { id: true, name: true, phone: true } } } } },
      }),
      () => this.prisma.surveyResponse.count({ where: { tenantId: t, sentAt: { gte: from, lt: to }, status: 'failed', scale, ...(f.surveyId && { surveyId: f.surveyId }), ...(f.agentId && { agentId: f.agentId }), ...escopo } }),
    ]);

    // perguntas adicionais: cada uma com a escala dela (texto e escala congelados na resposta).
    // SQL parametrizado — o JSON é desdobrado no banco em vez de trazer todas as respostas
    const extrasRaw = await this.load.run(() => this.prisma.$queryRaw<{ qid: string; question: string; scale: string; score: number; n: number }[]>(Prisma.sql`
      select a->>'questionId' as qid, max(a->>'question') as question, a->>'scale' as scale, (a->>'score')::int as score, count(*)::int as n
      from survey_responses r, jsonb_array_elements(r.answers) a
      where r."tenantId" = ${t} and r."sentAt" >= ${from} and r."sentAt" < ${to} and r.status <> 'failed'
        ${f.surveyId ? Prisma.sql`and r."surveyId" = ${f.surveyId}` : Prisma.empty}
        ${f.agentId ? Prisma.sql`and r."agentId" = ${f.agentId}` : Prisma.empty}
        ${nums ? Prisma.sql`and r."conversationId" in (select cs.id from conversations cs where cs."numberId" in (${Prisma.join(nums)}))` : Prisma.empty}
      group by 1, 3, 4`));
    const extras = new Map<string, { questionId: string; question: string; scale: SurveyScale; linhas: Linha[] }>();
    for (const e of extrasRaw) {
      if (!(SURVEY_SCALES as readonly string[]).includes(e.scale)) continue;
      const k = `${e.qid}|${e.scale}`;
      const cur = extras.get(k) ?? { questionId: e.qid, question: e.question, scale: e.scale as SurveyScale, linhas: [] };
      cur.linhas.push({ status: 'answered', score: e.score, n: e.n });
      extras.set(k, cur);
    }
    const extraQuestions = [...extras.values()].map(({ linhas, ...q }) => {
      const ind = indicadores(linhas, q.scale);
      return { ...q, answered: ind.answered, avg: ind.avg, satisfiedPct: ind.satisfiedPct, nps: ind.nps, distribution: ind.distribution };
    });

    // por consultor: nome atual do usuário (o congelado só quando o usuário saiu)
    const ids = [...new Set(porConsultor.map((r) => r.agentId).filter((x): x is string => !!x))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids }, tenantId: t }, select: { id: true, name: true } }) : [];
    const congelados = ids.length ? await this.prisma.surveyResponse.findMany({ where: { tenantId: t, agentId: { in: ids } }, distinct: ['agentId'], select: { agentId: true, agentName: true } }) : [];
    const nome = (id: string | null) => (id ? users.find((x) => x.id === id)?.name ?? congelados.find((x) => x.agentId === id)?.agentName ?? 'Usuário removido' : 'Sem consultor');
    const grupos = new Map<string, Linha[]>();
    for (const r of porConsultor) {
      const k = r.agentId ?? '';
      grupos.set(k, [...(grupos.get(k) ?? []), { status: r.status, score: r.score, n: r._count._all }]);
    }
    const byAgent = [...grupos.entries()]
      .map(([k, linhas]) => {
        const { distribution: _d, ...ind } = indicadores(linhas, scale!, aguardandoPorConsultor.find((a) => (a.agentId ?? '') === k)?._count._all ?? 0);
        return { agentId: k || null, name: nome(k || null), ...ind };
      })
      .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.answered - a.answered);

    return {
      scale,
      from,
      to,
      scales: porEscala.map((s) => ({ scale: s.scale, count: s._count._all })),
      totals: { ...indicadores(totais.map((r) => ({ status: r.status, score: r.score, n: r._count._all })), scale, aguardando), failed },
      byAgent,
      extraQuestions,
      comments: {
        total,
        page: f.page,
        pageSize: f.pageSize,
        rows: rows.map((r) => ({
          id: r.id,
          score: r.score,
          comment: r.comment,
          answeredAt: r.answeredAt,
          sentAt: r.sentAt,
          surveyName: r.survey.name,
          agent: r.agentId || r.agentName ? { id: r.agentId, name: r.agentId ? nome(r.agentId) : r.agentName } : null,
          conversationId: r.conversationId,
          contact: r.conversation.contact,
        })),
      },
    };
  }
}

@Module({ imports: [AuthModule, BillingModule], controllers: [SatisfactionSurveysController, SatisfactionReportController] })
export class SatisfactionModule {}
