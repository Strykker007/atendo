import { Body, Controller, Delete, Get, Injectable, Module, OnModuleInit, Param, Post, UseGuards } from '@nestjs/common';
import { BullModule, InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationScopeGuard } from '../conversations/conversation-scope.guard';
import { ScheduledMessagesService, type ScheduledMediaType } from './scheduled-messages.service';

export const QUEUE_SCHEDULED_MESSAGES = 'scheduled-messages';

class ScheduleDto {
  /** texto ou legenda; aceita {{variáveis}} */
  @IsString() @MaxLength(4096) content: string;
  /** ISO com fuso (o navegador manda o horário local já convertido) */
  @Type(() => Date) @IsDate() scheduledFor: Date;
  @IsOptional() @IsString() @MaxLength(300) mediaKey?: string;
  @IsOptional() @IsIn(['image', 'audio', 'video', 'document']) mediaType?: ScheduledMediaType;
  @IsOptional() @IsString() @MaxLength(200) mediaName?: string;
  @IsOptional() @IsString() @MaxLength(100) mediaMime?: string;
}

/** `:id` = conversa — o ConversationScopeGuard barra número/departamento de fora. */
@Controller('conversations/:id/scheduled-messages')
@UseGuards(JwtAuthGuard, PermissionsGuard, ConversationScopeGuard)
class ScheduledMessagesController {
  constructor(private readonly scheduled: ScheduledMessagesService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.scheduled.list(u.tenantId, id);
  }

  @Post()
  @RequirePermission('conversations.schedule_message')
  create(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ScheduleDto) {
    return this.scheduled.create(u.tenantId, u.id, id, dto);
  }

  @Delete(':scheduledId')
  @RequirePermission('conversations.schedule_message')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('scheduledId') scheduledId: string) {
    return this.scheduled.cancel(u.tenantId, u.id, id, scheduledId);
  }
}

/** Verifica a cada minuto o que já venceu. */
@Injectable()
class ScheduledMessagesScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_SCHEDULED_MESSAGES) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('scheduled-messages', { every: 60_000 }, { name: 'scheduled-messages' });
  }
}

@Processor(QUEUE_SCHEDULED_MESSAGES)
class ScheduledMessagesProcessor extends TrackedWorkerHost {
  constructor(private readonly scheduled: ScheduledMessagesService) {
    super(QUEUE_SCHEDULED_MESSAGES);
  }
  protected async handle(_job: Job) {
    await this.scheduled.runDue();
  }
}

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_SCHEDULED_MESSAGES, defaultJobOptions: { removeOnComplete: 50, removeOnFail: 50 } }),
    AuthModule,
    ConversationsModule,
  ],
  controllers: [ScheduledMessagesController],
  providers: [ScheduledMessagesService, ScheduledMessagesScheduler, ScheduledMessagesProcessor],
})
export class ScheduledMessagesModule {}
