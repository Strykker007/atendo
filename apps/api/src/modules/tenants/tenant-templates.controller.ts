import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { uniqueName } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { NoTenantOk } from '../auth/tenant.guard';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { parseTemplateContent, parseTemplateFile, provisionedLossReasons, templateContent, templateSummary, toTemplateFile, type TemplateContent, type TemplateFile } from './tenant-template';

class CreateDto {
  @IsString() @MaxLength(60) name: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
}
class UpdateDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  /** vira o modelo pré-escolhido no "Novo cliente" (desmarca o anterior) */
  @IsOptional() @IsBoolean() isDefault?: boolean;
  /** conteúdo inteiro (perfis, respostas, fluxos, motivos) — o editor salva tudo de uma vez */
  @IsOptional() @IsObject() content?: Record<string, unknown>;
}
class CaptureDto {
  @IsUUID() tenantId: string;
  @IsString() @MaxLength(60) name: string;
}

/**
 * Modelos de perfil (Farmácia, Clínica…) — só o dono do sistema. O conteúdo entra e sai como
 * arquivo `.json` (ver `tenant-template.ts`); clientes criados com o modelo recebem tudo na
 * criação. Mudar o modelo depois não mexe em quem já foi criado.
 */
@Controller('tenant-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantTemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: TenantProvisioningService,
  ) {}

  @Get()
  @NoTenantOk()
  @Roles('super_admin')
  async list() {
    const rows = await this.prisma.tenantTemplate.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { tenants: true } } } });
    return rows.map((t) => ({ id: t.id, name: t.name, description: t.description, isDefault: t.isDefault, updatedAt: t.updatedAt, tenants: t._count.tenants, ...templateSummary(t.content as unknown as TemplateContent) }));
  }

  /** Para o editor: conteúdo completo + os motivos efetivos (os do catálogo quando o modelo não define). */
  @Get(':id')
  @NoTenantOk()
  @Roles('super_admin')
  async get(@Param('id') id: string) {
    const t = await this.prisma.tenantTemplate.findUniqueOrThrow({ where: { id }, include: { _count: { select: { tenants: true } } } });
    const content = t.content as unknown as TemplateContent;
    return { id: t.id, name: t.name, description: t.description, isDefault: t.isDefault, tenants: t._count.tenants, content, effectiveLossReasons: provisionedLossReasons(content) };
  }

  /** Modelo vazio, para montar pelo editor. */
  @Post()
  @NoTenantOk()
  @Roles('super_admin')
  async create(@Body() dto: CreateDto) {
    const taken = (await this.prisma.tenantTemplate.findMany({ select: { name: true } })).map((t) => t.name);
    const empty: TemplateContent = { profiles: [], quickReplies: [], flows: [] };
    return this.prisma.tenantTemplate.create({ data: { name: uniqueName(dto.name.trim(), taken, 60), description: dto.description?.trim() || null, content: empty as unknown as Prisma.InputJsonValue } });
  }

  @Get(':id/export')
  @NoTenantOk()
  @Roles('super_admin')
  async export(@Param('id') id: string) {
    const t = await this.prisma.tenantTemplate.findUniqueOrThrow({ where: { id } });
    return toTemplateFile({ name: t.name, description: t.description, content: t.content as unknown as TemplateContent });
  }

  /** Novo modelo a partir do arquivo. Nome repetido vira "(cópia)". */
  @Post('import')
  @NoTenantOk()
  @Roles('super_admin')
  async import(@Body() body: unknown) {
    const file = this.parse(body);
    const taken = (await this.prisma.tenantTemplate.findMany({ select: { name: true } })).map((t) => t.name);
    return this.prisma.tenantTemplate.create({ data: { name: uniqueName(file.name, taken, 60), description: file.description ?? null, content: templateContent(file) as unknown as Prisma.InputJsonValue } });
  }

  /** Carrega o arquivo num modelo existente: substitui o conteúdo, mantém nome e descrição. */
  @Put(':id')
  @NoTenantOk()
  @Roles('super_admin')
  async replace(@Param('id') id: string, @Body() body: unknown) {
    const file = this.parse(body);
    return this.prisma.tenantTemplate.update({ where: { id }, data: { content: templateContent(file) as unknown as Prisma.InputJsonValue } });
  }

  /** Tira um modelo de um cliente que já está configurado — o jeito prático de montar o primeiro. */
  @Post('capture')
  @NoTenantOk()
  @Roles('super_admin')
  async capture(@Body() dto: CaptureDto) {
    const { content, warnings } = await this.provisioning.capture(dto.tenantId);
    const taken = (await this.prisma.tenantTemplate.findMany({ select: { name: true } })).map((t) => t.name);
    const template = await this.prisma.tenantTemplate.create({ data: { name: uniqueName(dto.name.trim(), taken, 60), content: content as unknown as Prisma.InputJsonValue } });
    return { template, warnings };
  }

  @Patch(':id')
  @NoTenantOk()
  @Roles('super_admin')
  async update(@Param('id') id: string, @Body() dto: UpdateDto) {
    if (dto.name !== undefined && !dto.name.trim()) throw new BadRequestException('Informe o nome.');
    let content: TemplateContent | undefined;
    if (dto.content) {
      try {
        content = parseTemplateContent(dto.content);
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : 'Conteúdo inválido.');
      }
      this.provisioning.assertFlows(content.flows);
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        // um padrão só: marcar este desmarca o anterior
        if (dto.isDefault) await tx.tenantTemplate.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
        return tx.tenantTemplate.update({
          where: { id },
          data: {
            name: dto.name?.trim(),
            description: dto.description === undefined ? undefined : dto.description.trim() || null,
            isDefault: dto.isDefault,
            content: content as unknown as Prisma.InputJsonValue | undefined,
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Já existe um modelo com esse nome.');
      throw e;
    }
  }

  /** Clientes criados com ele não mudam nada: o modelo só é lido na criação. */
  @Delete(':id')
  @NoTenantOk()
  @Roles('super_admin')
  async remove(@Param('id') id: string) {
    await this.prisma.tenantTemplate.delete({ where: { id } });
    return { ok: true };
  }

  private parse(body: unknown): TemplateFile {
    let file: TemplateFile;
    try {
      file = parseTemplateFile((body as { portable?: unknown })?.portable ?? body);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Arquivo inválido.');
    }
    this.provisioning.assertFlows(file.flows);
    return file;
  }
}
