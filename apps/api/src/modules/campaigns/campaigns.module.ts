import { Body, Controller, Get, Module, Param, Post, UseGuards } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TemplateChoiceDto } from '../whatsapp/template.dto';
import { AUDIENCE_MAX, SegmentationService } from './segmentation.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { BillingModule } from '../billing/billing.module';
import { FeatureGuard, RequireFeature } from '../billing/feature.guard';
import { TenantsModule } from '../tenants/tenants.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { CampaignsService, type Audience } from './campaigns.service';
import { CampaignProcessor } from './campaign.processor';
import { GroupSender } from './group-sender';
import { QUEUE_CAMPAIGN } from './queues';

class AudienceDto implements Audience {
  @IsOptional() @IsBoolean() all?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) tagIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) closingTagIds?: string[];
  @IsOptional() @IsISO8601() closingFrom?: string;
  @IsOptional() @IsISO8601() closingTo?: string;
  @IsOptional() @IsIn(['won', 'lost']) lastOutcome?: 'won' | 'lost';
  @IsOptional() @IsUUID() agentId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(AUDIENCE_MAX) @IsUUID('4', { each: true }) contactIds?: string[];
  /** telefones colados/importados (um por item) */
  @IsOptional() @IsArray() @ArrayMaxSize(AUDIENCE_MAX) @IsString({ each: true }) @MaxLength(40, { each: true }) phones?: string[];
  /** grupos autorizados (docs/grupos.md) — só QR Code, só do número da transmissão */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('4', { each: true }) groupIds?: string[];
}
class CreateCampaignDto {
  @IsString() @MaxLength(80) name: string;
  @IsUUID() numberId: string;
  /** QR: texto (com {{contact.first_name}}, {{saudacao}}, variáveis da empresa…) e/ou anexo. Meta: ignorado (vai o template) */
  @IsOptional() @IsString() @MaxLength(4000) text?: string;
  /** chave devolvida por POST /uploads */
  @IsOptional() @IsString() mediaKey?: string;
  @IsOptional() @IsIn(['image', 'document', 'audio', 'video']) mediaType?: string;
  @IsOptional() @IsString() @MaxLength(200) mediaName?: string;
  /** API oficial: template aprovado (obrigatório) */
  @IsOptional() @ValidateNested() @Type(() => TemplateChoiceDto) template?: TemplateChoiceDto;
  @IsOptional() @IsISO8601() startAt?: string;
  @IsOptional() @IsBoolean() businessHoursOnly?: boolean;
  @ValidateNested() @Type(() => AudienceDto) audience: AudienceDto;
}
class StartDto {
  /** QR Code: aceite do aviso de risco de bloqueio (obrigatório na 1ª vez) */
  @IsOptional() @IsBoolean() acceptRisk?: boolean;
}
class StatusDto {
  @IsIn(['paused', 'running', 'canceled']) status: 'paused' | 'running' | 'canceled';
}

/** Transmissão (disparo em massa) — funcionalidade plugável no plano. */
@Controller('campaigns')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, FeatureGuard)
@RequireFeature('campaigns')
@RequirePermission('campaigns.manage')
class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.campaigns.list(u.tenantId);
  }

  @Get(':id')
  one(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.campaigns.one(u.tenantId, id);
  }

  /** Quantos contatos a seleção atinge — mostrado antes de criar, para não haver surpresa. */
  @Post('preview')
  preview(@CurrentUser() u: AuthUser, @Body() body: AudienceDto) {
    // contagem para a tela: sem critério, zero (não "todos")
    return this.campaigns.preview(u.tenantId, body);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(u.tenantId, u.id, dto);
  }

  @Post(':id/start')
  start(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: StartDto) {
    return this.campaigns.start(u.tenantId, u.id, id, dto.acceptRisk);
  }

  @Post(':id/status')
  status(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.campaigns.setStatus(u.tenantId, id, dto.status);
  }
}

@Module({
  imports: [AuthModule, BillingModule, TenantsModule, WhatsAppModule, ConversationsModule, BullModule.registerQueue({ name: QUEUE_CAMPAIGN })],
  controllers: [CampaignsController],
  providers: [CampaignsService, SegmentationService, CampaignProcessor, GroupSender],
  exports: [CampaignsService],
})
export class CampaignsModule {}
