import { Body, Controller, Get, Injectable, Module, Patch, Query, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { ConversationOrigin, type Prisma } from '@prisma/client';
import { KANBAN_NO_STAGE, type KanbanBoard, type KanbanCard, type KanbanTag, type ReorderColumnsInput } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { textSearch } from '../../common/text-search';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { narrowTo } from '../auth/number-scope';
import { departmentWhere } from '../auth/department-scope';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';

/**
 * Teto de cards no quadro. Kanban é para o que está andando: com milhares de atendimentos
 * abertos o quadro vira uma lista ruim, e a tela de conversas (paginada) é o lugar certo.
 */
const BOARD_LIMIT = 500;

const lista = ({ value }: { value: unknown }) => (Array.isArray(value) ? value : String(value).split(',').filter(Boolean));
const booleano = ({ value }: { value: unknown }) => value === true || value === '1' || value === 'true';

/** Mesmos filtros da lista de conversas que fazem sentido para atendimento aberto. */
class BoardQuery {
  /** um número ou vários separados por vírgula */
  @IsOptional() @Matches(/^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,49}$/i, { message: 'numberId inválido' }) numberId?: string;
  /** id do departamento ou `none` (só as sem departamento) */
  @IsOptional() @ValidateIf((_, v) => v !== 'none') @IsUUID() departmentId?: string;
  /** tag da conversa OU do contato */
  @IsOptional() @Transform(lista) @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) tagIds?: string[];
  @IsOptional() @IsIn(['waiting', 'in_progress']) status?: 'waiting' | 'in_progress';
  /** só com `conversations.view_all`; `none` = sem atendente */
  @IsOptional() @ValidateIf((_, v) => v !== 'none') @IsUUID() assigneeId?: string;
  @IsOptional() @IsEnum(ConversationOrigin) origin?: ConversationOrigin;
  @IsOptional() @Transform(booleano) @IsBoolean() unread?: boolean;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
type BoardFilters = Partial<BoardQuery>;
class ReorderDto implements ReorderColumnsInput {
  @IsArray() @ArrayMaxSize(200) @IsUUID('4', { each: true }) tagIds: string[];
}

@Injectable()
export class KanbanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly gateway: ConversationsGateway,
  ) {}

  /**
   * Quadro: colunas = tags com `isKanban`; cards = atendimentos abertos que a pessoa enxerga.
   * Mesma regra de posse da lista de conversas: `waiting` todo mundo vê; `in_progress` só o
   * dono, a não ser com `conversations.view_all`. E só dos números e departamentos que ela opera.
   */
  async board(u: AuthUser, f: BoardFilters = {}): Promise<KanbanBoard> {
    const viewAll = u.role === 'super_admin' || !!u.permissions?.includes('conversations.view_all');
    // o número pedido é interseccionado com o escopo; `null` = nada sobrou, e o quadro vem vazio
    const scoped = narrowTo(u, f.numberId);
    const where: Prisma.ConversationWhereInput = {
      tenantId: u.tenantId,
      status: f.status ?? { in: ['waiting', 'in_progress'] },
      ...(scoped === null ? { numberId: '-' } : scoped !== undefined ? { numberId: scoped } : {}),
      // filtro por atendente é de quem vê a equipe; para os outros a regra de posse abaixo já basta
      ...(viewAll && f.assigneeId && { assigneeId: f.assigneeId === 'none' ? null : f.assigneeId }),
      ...(f.origin && { origin: f.origin }),
      ...(f.unread && { unreadCount: { gt: 0 } }),
      ...(f.search?.trim() && { contact: textSearch(f.search) }),
      // tag da conversa OU tag do contato (mesma regra da lista de conversas)
      ...(f.tagIds?.length && { OR: [{ tags: { some: { tagId: { in: f.tagIds } } } }, { contact: { tags: { some: { tagId: { in: f.tagIds } } } } }] }),
      // posse e departamento usam OR: cada um no seu item do AND
      AND: [departmentWhere(u, f.departmentId) ?? {}, viewAll ? {} : { OR: [{ status: 'waiting' }, { assigneeId: u.id }] }],
    };
    const [columns, rows] = await Promise.all([
      this.prisma.tag.findMany({
        // transição (etapa do atendimento) e permanente (classificação do contato, 📌)
        where: { tenantId: u.tenantId, isKanban: true },
        select: { id: true, name: true, color: true, position: true, kind: true },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.conversation.findMany({
        where,
        include: {
          contact: { select: { id: true, name: true, phone: true, avatarUrl: true, tags: { include: { tag: true } } } },
          tags: { include: { tag: true }, orderBy: { createdAt: 'asc' } },
          assignee: { select: { id: true, name: true } },
          number: { select: { id: true, label: true, phone: true, color: true } },
        },
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }],
        take: BOARD_LIMIT + 1,
      }),
    ]);

    const truncated = rows.length > BOARD_LIMIT;
    const pill = (t: { id: string; name: string; color: string; isKanban: boolean; kind: KanbanTag['kind'] }): KanbanTag => ({ id: t.id, name: t.name, color: t.color, isKanban: t.isKanban, kind: t.kind });
    const coluna = new Map(columns.map((c, i) => [c.id, { ...c, ordem: i }]));
    const cards = rows.slice(0, BOARD_LIMIT).map((r): KanbanCard => {
      const c = this.conversations.presentContact(r);
      const primary = r.tags.find((t) => t.isPrimary);
      // atendimento primeiro; sem etapa dele, a 1ª permanente-coluna do contato (ordem do quadro)
      const permanente = r.contact.tags
        .map((t) => coluna.get(t.tagId))
        .filter((c): c is NonNullable<typeof c> => !!c && c.kind === 'permanent')
        .sort((a, b) => a.ordem - b.ordem)[0];
      const columnId = (primary && coluna.has(primary.tagId) ? primary.tagId : permanente?.id) ?? KANBAN_NO_STAGE;
      return {
        id: r.id,
        status: r.status as KanbanCard['status'],
        lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
        lastMessagePreview: r.lastMessagePreview,
        unreadCount: r.unreadCount,
        awaitingSince: r.awaitingSince?.toISOString() ?? null,
        contact: { id: c.contact.id, name: c.contact.name, phone: c.contact.phone, avatarUrl: c.contact.avatarUrl },
        assignee: r.assignee,
        number: r.number,
        primaryTagId: primary?.tagId ?? null,
        columnId,
        secondaryTags: r.tags.filter((t) => !t.isPrimary).map((t) => pill(t.tag)),
        contactTags: r.contact.tags.map((t) => pill(t.tag)),
      };
    });
    return { columns, cards, limit: BOARD_LIMIT, truncated };
  }

  /** Nova ordem das colunas. Ids de fora do tenant são ignorados pelo `where`. */
  async reorder(tenantId: string, tagIds: string[]) {
    await this.prisma.$transaction(tagIds.map((id, position) => this.prisma.tag.updateMany({ where: { id, tenantId }, data: { position } })));
    this.gateway.emitKanban(tenantId);
    return { ok: true };
  }
}

@Controller('kanban')
@UseGuards(JwtAuthGuard, PermissionsGuard)
class KanbanController {
  constructor(private readonly kanban: KanbanService) {}

  @Get()
  board(@CurrentUser() u: AuthUser, @Query() q: BoardQuery) {
    return this.kanban.board(u, q);
  }

  @Patch('columns')
  @RequirePermission('tags.manage')
  reorder(@CurrentUser() u: AuthUser, @Body() dto: ReorderDto) {
    return this.kanban.reorder(u.tenantId, dto.tagIds);
  }
}

/** Mover card não mora aqui: é `PATCH /conversations/:id/primary-tag`, que já passa pelo `ConversationScopeGuard`. */
@Module({ imports: [AuthModule, ConversationsModule], controllers: [KanbanController], providers: [KanbanService] })
export class KanbanModule {}
