import { BadRequestException, Body, Controller, Delete, Get, Module, NotFoundException, Param, Patch, Put, Post, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PIX_KEY_TYPES, PIX_KEY_TYPE_LABEL, type PixKeyType, type MessageContent, type PixPayment } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

export const PIX_KEYS_MAX = 30;

class PixKeyDto {
  @IsString() @MaxLength(60) title: string;
  @IsIn(PIX_KEY_TYPES) keyType: PixKeyType;
  @IsString() @MaxLength(77) key: string;
  /** nome do recebedor no cartão; vazio = o título */
  @IsOptional() @IsString() @MaxLength(60) holderName?: string;
}

class ReorderPixKeysDto {
  /** ids na ordem nova (a do chat) */
  @IsArray() @ArrayMaxSize(PIX_KEYS_MAX) @IsUUID('4', { each: true }) ids: string[];
}

const select = { id: true, title: true, keyType: true, key: true, holderName: true, position: true } as const;

/** Normaliza e confere a chave pelo tipo — chave errada no cartão é Pix para ninguém. */
export function normalizePixKey(keyType: PixKeyType, raw: string): string {
  const key = raw.trim();
  const digits = key.replace(/\D/g, '');
  switch (keyType) {
    case 'cpf':
      if (digits.length !== 11) throw new BadRequestException('CPF precisa ter 11 dígitos');
      return digits;
    case 'cnpj':
      if (digits.length !== 14) throw new BadRequestException('CNPJ precisa ter 14 dígitos');
      return digits;
    case 'phone': {
      // chave telefone do Pix é +55DDDNÚMERO; aceita digitado sem o 55
      const full = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
      if (!/^55\d{10,11}$/.test(full)) throw new BadRequestException('Telefone precisa ter DDD + número');
      return `+${full}`;
    }
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) throw new BadRequestException('E-mail inválido');
      return key.toLowerCase();
    case 'random':
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) throw new BadRequestException('Chave aleatória inválida (formato 8-4-4-4-12)');
      return key.toLowerCase();
  }
}

/**
 * Mensagem de uma chave Pix: o texto é o que fica no histórico e o que sai onde não há cartão
 * (Meta); `content` desenha o cartão no chat; `pix` vai para o adapter montar o botão nativo.
 */
export function pixMessage(k: { title: string; keyType: string; key: string; holderName: string }): { text: string; content: MessageContent; pix: PixPayment } {
  const keyType = k.keyType as PixKeyType;
  const tipo = PIX_KEY_TYPE_LABEL[keyType] ?? k.keyType;
  return {
    // chave sozinha na última linha: sem o cartão, é o que o contato segura para copiar
    text: `*${k.title}*\nTipo: ${tipo}\nChave Pix:\n${k.key}`,
    content: { kind: 'buttons', footer: k.holderName, buttons: [{ kind: 'copy', title: 'Copiar chave Pix', value: k.key }] },
    pix: { holderName: k.holderName, keyType, key: k.key },
  };
}

/**
 * Chaves Pix da empresa, enviadas pelo painel do chat (docs/07-api.md). Listar é livre para a
 * equipe (o painel precisa); cadastrar/editar/excluir: `quick_replies.manage`.
 */
@Controller('tenants/me/pix-keys')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PermissionsGuard)
class PixKeysController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.pixKey.findMany({ where: { tenantId: u.tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select });
  }

  @Post()
  @RequirePermission('quick_replies.manage')
  async create(@CurrentUser() u: AuthUser, @Body() dto: PixKeyDto) {
    const total = await this.prisma.pixKey.count({ where: { tenantId: u.tenantId } });
    if (total >= PIX_KEYS_MAX) throw new BadRequestException(`Limite de ${PIX_KEYS_MAX} chaves Pix por empresa`);
    return this.prisma.pixKey.create({ data: { tenantId: u.tenantId, position: total, ...this.data(dto) }, select });
  }

  /** Ordem das chaves (setas na tela): ids na ordem nova; id de outro cliente é ignorado. Antes de `:id`. */
  @Patch('reorder')
  @RequirePermission('quick_replies.manage')
  async reorder(@CurrentUser() u: AuthUser, @Body() dto: ReorderPixKeysDto) {
    await this.prisma.$transaction(dto.ids.map((id, position) => this.prisma.pixKey.updateMany({ where: { id, tenantId: u.tenantId }, data: { position } })));
    return { ok: true };
  }

  @Put(':id')
  @RequirePermission('quick_replies.manage')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: PixKeyDto) {
    await this.findOrThrow(u.tenantId, id);
    return this.prisma.pixKey.update({ where: { id, tenantId: u.tenantId }, data: this.data(dto), select });
  }

  @Delete(':id')
  @RequirePermission('quick_replies.manage')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.findOrThrow(u.tenantId, id);
    await this.prisma.pixKey.delete({ where: { id, tenantId: u.tenantId } });
    return { ok: true };
  }

  private data(dto: PixKeyDto) {
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Dê um título à chave');
    return { title, keyType: dto.keyType, key: normalizePixKey(dto.keyType, dto.key), holderName: dto.holderName?.trim() || title };
  }

  private async findOrThrow(tenantId: string, id: string) {
    const k = await this.prisma.pixKey.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!k) throw new NotFoundException('Chave Pix não encontrada');
  }
}

@Module({ imports: [AuthModule], controllers: [PixKeysController] })
export class PixKeysModule {}
