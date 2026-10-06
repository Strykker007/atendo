import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Put, UseGuards } from '@nestjs/common';
import { ContactAttributeType } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsString, MaxLength, ValidateNested } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

class AttributeDto {
  @IsString() @MaxLength(60) label: string;
  @IsEnum(ContactAttributeType) type: ContactAttributeType;
  @IsString() @MaxLength(1000) value: string;
}
class AttributesDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AttributeDto) items: AttributeDto[];
}

/** Valida e normaliza conforme o tipo. Campo sem nome e sem valor (linha em branco) é ignorado. */
function normalize(a: AttributeDto) {
  const label = a.label.trim();
  const value = a.value.trim();
  if (!label && !value) return null;
  if (!label) throw new BadRequestException(`Dê um nome ao campo com o valor "${value.slice(0, 30)}"`);
  if (!value) throw new BadRequestException(`${label}: preencha o valor ou remova o campo`);
  if (a.type === 'number' && !/^-?\d+([.,]\d+)?$/.test(value)) throw new BadRequestException(`${label}: informe um número`);
  if (a.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) throw new BadRequestException(`${label}: data inválida`);
  return { label, type: a.type, value: a.type === 'number' ? value.replace(',', '.') : value };
}

/**
 * Campos livres da ficha, por contato: cada cliente tem os dados que fazem sentido para ele
 * (CPF de um, placa do carro de outro). Ver docs/campos-personalizados.md.
 */
@Controller('contact-attributes')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
class ContactAttributesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Nomes já usados na empresa, mais usados primeiro — sugestão ao digitar, para não virar "CPF"/"cpf"/"C.P.F.". */
  @Get('labels')
  async labels(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.contactAttribute.groupBy({
      by: ['label', 'type'],
      where: { tenantId: u.tenantId },
      _count: { _all: true },
      orderBy: { _count: { label: 'desc' } },
      take: 100,
    });
    return rows.map((r) => ({ label: r.label, type: r.type }));
  }

  @Get(':contactId')
  async list(@CurrentUser() u: AuthUser, @Param('contactId') contactId: string) {
    await this.contactOrThrow(u.tenantId, contactId);
    return this.prisma.contactAttribute.findMany({
      where: { contactId, tenantId: u.tenantId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, label: true, type: true, value: true },
    });
  }

  /** Substitui a lista inteira do contato (a ficha manda tudo de uma vez, na ordem da tela). */
  @Put(':contactId')
  @RequirePermission('contacts.edit')
  async replace(@CurrentUser() u: AuthUser, @Param('contactId') contactId: string, @Body() dto: AttributesDto) {
    await this.contactOrThrow(u.tenantId, contactId);
    const items = dto.items.map(normalize).filter((a): a is NonNullable<typeof a> => !!a);
    const nomes = new Set<string>();
    for (const a of items) {
      const k = a.label.toLowerCase();
      if (nomes.has(k)) throw new BadRequestException(`Campo "${a.label}" repetido`);
      nomes.add(k);
    }
    await this.prisma.$transaction([
      this.prisma.contactAttribute.deleteMany({ where: { contactId, tenantId: u.tenantId } }),
      this.prisma.contactAttribute.createMany({ data: items.map((a, position) => ({ ...a, position, contactId, tenantId: u.tenantId })) }),
    ]);
    return this.list(u, contactId);
  }

  private async contactOrThrow(tenantId: string, contactId: string) {
    const c = await this.prisma.contact.findFirst({ where: { id: contactId, tenantId }, select: { id: true } });
    if (!c) throw new NotFoundException('Contato não encontrado');
  }
}

@Module({ imports: [AuthModule], controllers: [ContactAttributesController] })
export class ContactAttributesModule {}
