import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Module, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { GLOBAL_VARIABLES_MAX, GLOBAL_VARIABLE_KEY_MAX, GLOBAL_VARIABLE_VALUE_MAX, globalVarKey, globalVarKeyError } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

class CreateGlobalVariableDto {
  @IsString() @MaxLength(80) label: string;
  /** sem chave = gerada do rótulo ("Chave PIX" → `chave_pix`) */
  @IsOptional() @IsString() @MaxLength(GLOBAL_VARIABLE_KEY_MAX) key?: string;
  @IsString() @MaxLength(GLOBAL_VARIABLE_VALUE_MAX) value: string;
}
class UpdateGlobalVariableDto {
  @IsOptional() @IsString() @MaxLength(80) label?: string;
  @IsOptional() @IsString() @MaxLength(GLOBAL_VARIABLE_KEY_MAX) key?: string;
  @IsOptional() @IsString() @MaxLength(GLOBAL_VARIABLE_VALUE_MAX) value?: string;
}

const select = { id: true, key: true, label: true, value: true, updatedAt: true } as const;

/** Chave em uso na empresa → 409 com mensagem legível (em vez do erro do Prisma). */
function duplicate(e: unknown, key: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Já existe uma variável {{${key}}}`);
  throw e;
}

/**
 * Variáveis da empresa: valores fixos (chave PIX, horário, link do catálogo) que entram em
 * qualquer texto como `{{global.<key>}}` / `{{<key>}}`. Ver docs/variaveis.md.
 * Listar é livre para a equipe (o menu "Inserir variável" precisa). Criar: `variables.manage` ou
 * `flows.manage` (o "+ Criar nova variável global" do editor de fluxos); editar/excluir só
 * `variables.manage` — mexer numa existente muda o texto de todo lugar que a usa.
 */
@Controller('tenants/me/global-variables')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PermissionsGuard)
class GlobalVariablesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.globalVariable.findMany({ where: { tenantId: u.tenantId }, orderBy: { label: 'asc' }, select });
  }

  @Post()
  @RequirePermission('variables.manage', 'flows.manage')
  async create(@CurrentUser() u: AuthUser, @Body() dto: CreateGlobalVariableDto) {
    const label = dto.label.trim();
    if (!label) throw new BadRequestException('Dê um nome à variável');
    const key = checkKey(dto.key?.trim() || globalVarKey(label));
    const total = await this.prisma.globalVariable.count({ where: { tenantId: u.tenantId } });
    if (total >= GLOBAL_VARIABLES_MAX) throw new BadRequestException(`Limite de ${GLOBAL_VARIABLES_MAX} variáveis por empresa`);
    return this.prisma.globalVariable.create({ data: { tenantId: u.tenantId, key, label, value: dto.value }, select }).catch((e) => duplicate(e, key));
  }

  /** Trocar a chave quebra os textos que já usam a antiga — a tela avisa antes. */
  @Put(':id')
  @RequirePermission('variables.manage')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateGlobalVariableDto) {
    await this.findOrThrow(u.tenantId, id);
    const label = dto.label?.trim();
    if (label === '') throw new BadRequestException('Dê um nome à variável');
    const key = dto.key === undefined ? undefined : checkKey(dto.key.trim());
    return this.prisma.globalVariable.update({ where: { id, tenantId: u.tenantId }, data: { label, key, value: dto.value }, select }).catch((e) => duplicate(e, key ?? ''));
  }

  @Delete(':id')
  @RequirePermission('variables.manage')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.findOrThrow(u.tenantId, id);
    await this.prisma.globalVariable.delete({ where: { id, tenantId: u.tenantId } });
    return { ok: true };
  }

  private async findOrThrow(tenantId: string, id: string) {
    const v = await this.prisma.globalVariable.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!v) throw new NotFoundException('Variável não encontrada');
  }
}

function checkKey(key: string) {
  const err = globalVarKeyError(key);
  if (err) throw new BadRequestException(err);
  return key;
}

@Module({ imports: [AuthModule], controllers: [GlobalVariablesController] })
export class GlobalVariablesModule {}
