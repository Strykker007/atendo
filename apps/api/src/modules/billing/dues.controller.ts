import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { DuesService } from './dues.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

class PayDuesDto {
  /** chaves das linhas do painel (`group`, `company:<id>`) — o valor é recalculado na API */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(60, { each: true }) keys: string[];
  /** CPF/CNPJ de quem paga; só exigido quando o cliente ainda não tem cadastro no Asaas */
  @IsOptional() @Matches(/^[\d.\-/ ]{11,20}$/, { message: 'CPF/CNPJ inválido' }) cpfCnpj?: string;
}

/** Painel de vencimentos do grupo (docs/empresas.md#cobrança). */
@Controller('billing/dues')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('billing.manage')
export class DuesController {
  constructor(private readonly dues: DuesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.dues.list(user.tenantId);
  }

  /** "Pagar todos": cobrança única (boleto/PIX) das linhas escolhidas; devolve a cobrança com o QR. */
  @Post('pay')
  pay(@CurrentUser() user: AuthUser, @Body() dto: PayDuesDto) {
    return this.dues.payBulk(user.tenantId, dto.keys, dto.cpfCnpj);
  }
}
