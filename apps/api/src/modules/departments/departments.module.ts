import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Module, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsHexColor, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { PermissionsService } from '../auth/permissions.service';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

class DepartmentDto {
  @IsString() @MaxLength(40) name: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string | null;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** participantes; ausente = não mexe. Substitui a lista inteira */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) userIds?: string[];
}

const SELECT = {
  id: true, name: true, description: true, color: true, isActive: true, createdAt: true,
  users: { select: { user: { select: { id: true, name: true, isActive: true } } } },
  _count: { select: { conversations: { where: { status: { not: 'closed' } } } } },
} satisfies Prisma.DepartmentSelect;

/**
 * Departamentos (Vendas, Suporte, Balcão…). A listagem é aberta a toda a equipe — o filtro da
 * fila, a etiqueta da conversa e a transferência precisam dela. Criar, editar e escolher quem
 * participa é gestão de equipe (`team.manage`). Ver docs/departamentos.md.
 */
@Controller('departments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
class DepartmentsController {
  constructor(private readonly prisma: PrismaService, private readonly permissions: PermissionsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.department.findMany({ where: { tenantId: u.tenantId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], select: SELECT });
  }

  @Post()
  @RequirePermission('team.manage')
  async create(@CurrentUser() u: AuthUser, @Body() dto: DepartmentDto) {
    const { userIds, ...data } = dto;
    const dept = await this.prisma.department
      .create({ data: { tenantId: u.tenantId, ...data, name: data.name.trim(), description: data.description?.trim() || null } })
      .catch(duplicate);
    if (userIds) await this.setUsers(u.tenantId, dept.id, userIds);
    return this.prisma.department.findUniqueOrThrow({ where: { id: dept.id }, select: SELECT });
  }

  @Patch(':id')
  @RequirePermission('team.manage')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Partial<DepartmentDto>) {
    const { userIds, ...data } = dto;
    await this.prisma.department.findFirstOrThrow({ where: { id, tenantId: u.tenantId }, select: { id: true } });
    await this.prisma.department
      .update({
        where: { id, tenantId: u.tenantId },
        data: { ...data, ...(data.name !== undefined && { name: data.name.trim() }), ...(data.description !== undefined && { description: data.description?.trim() || null }) },
      })
      .catch(duplicate);
    if (userIds) await this.setUsers(u.tenantId, id, userIds);
    return this.prisma.department.findUniqueOrThrow({ where: { id }, select: SELECT });
  }

  /** As conversas do departamento ficam sem departamento (passam a aparecer para toda a equipe). */
  @Delete(':id')
  @RequirePermission('team.manage')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const dept = await this.prisma.department.delete({ where: { id, tenantId: u.tenantId } });
    this.permissions.invalidate();
    return dept;
  }

  /** Só usuários deste cliente: os ids vêm do corpo da requisição. */
  private async setUsers(tenantId: string, departmentId: string, userIds: string[]) {
    const valid = await this.prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] }, tenantId, role: { not: 'super_admin' } }, select: { id: true } });
    if (valid.length !== new Set(userIds).size) throw new BadRequestException('Algum participante não foi encontrado na equipe.');
    await this.prisma.$transaction([
      this.prisma.userDepartment.deleteMany({ where: { departmentId } }),
      this.prisma.userDepartment.createMany({ data: valid.map((v) => ({ userId: v.id, departmentId })), skipDuplicates: true }),
    ]);
    // o escopo de departamentos vem no cache de permissões: sem isto valeria só em 15 s
    this.permissions.invalidate();
  }
}

function duplicate(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('Já existe um departamento com esse nome.');
  throw err;
}

@Module({ imports: [AuthModule], controllers: [DepartmentsController] })
export class DepartmentsModule {}
