import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { REWRITE_TONES, type RewriteTone } from '@atendo/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';
import { AiService } from './ai.service';

class SuggestDto {
  @IsUUID() conversationId: string;
}
class RewriteDto {
  @IsString() @MaxLength(2000) text: string;
  @IsIn(Object.keys(REWRITE_TONES)) tone: RewriteTone;
  @IsOptional() @IsUUID() conversationId?: string;
}
class SummaryDto {
  @IsUUID() conversationId: string;
  /** ignora o cache e gera de novo (cobra uma interação) */
  @IsOptional() @IsBoolean() force?: boolean;
}

/**
 * Copiloto do atendente. Tudo aqui é **sugestão**: a resposta volta para o campo de
 * digitação e só vai para o cliente quando o atendente clicar em enviar.
 */
@Controller('ai')
@UseGuards(JwtAuthGuard, TenantGuard, FeatureGuard)
@RequireFeature('ai_copilot')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** Se a IA está configurada neste ambiente — o front esconde os botões quando não está. */
  @Get('status')
  status() {
    return { available: this.ai.available };
  }

  @Get('usage')
  usage(@CurrentUser() u: AuthUser) {
    return this.ai.summaryOfUsage(u.tenantId);
  }

  @Post('suggest')
  async suggest(@CurrentUser() u: AuthUser, @Body() dto: SuggestDto) {
    return { text: await this.ai.suggest(u.tenantId, dto.conversationId, { id: u.id, name: u.name }) };
  }

  @Post('rewrite')
  async rewrite(@CurrentUser() u: AuthUser, @Body() dto: RewriteDto) {
    return { text: await this.ai.rewrite(u.tenantId, dto.text, dto.tone, u.id, dto.conversationId) };
  }

  @Post('summary')
  summary(@CurrentUser() u: AuthUser, @Body() dto: SummaryDto) {
    return this.ai.summary(u.tenantId, dto.conversationId, u.id, dto.force);
  }
}
