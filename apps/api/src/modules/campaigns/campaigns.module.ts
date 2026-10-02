import { Body, Controller, Get, Module, Param, Post, UseGuards } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IsArray, IsBoolean, IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
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
import { QUEUE_CAMPAIGN } from './queues';

class AudienceDto {
  @IsIn(['all', 'tags', 'contacts']) kind: Audience['kind'];
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) tagIds?: string[];
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) contactIds?: string[];
}
class CreateCampaignDto {
  @IsString() @MaxLength(80) name: string;
  @IsUUID() numberId: string;
  @IsString() @MaxLength(4000) text: string;
  @IsOptional() @IsString() mediaKey?: string;
  @IsOptional() @IsString() mediaType?: string;
  @IsOptional() @IsString() mediaName?: string;
  @IsOptional() @IsObject() template?: Record<string, unknown>;
  @IsOptional() @IsISO8601() startAt?: string;
  @IsOptional() @IsBoolean() businessHoursOnly?: boolean;
  @IsObject() audience: AudienceDto;
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
    return this.campaigns.preview(u.tenantId, body);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(u.tenantId, u.id, dto);
  }

  @Post(':id/start')
  start(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.campaigns.start(u.tenantId, id);
  }

  @Post(':id/status')
  status(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.campaigns.setStatus(u.tenantId, id, dto.status);
  }
}

@Module({
  imports: [AuthModule, BillingModule, TenantsModule, WhatsAppModule, ConversationsModule, BullModule.registerQueue({ name: QUEUE_CAMPAIGN })],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignProcessor],
  exports: [CampaignsService],
})
export class CampaignsModule {}
