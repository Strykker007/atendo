import { Controller, Get, Headers, Post, Query, Req, HttpCode, UnauthorizedException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { env } from '../../config/env';
import { ProviderRegistry } from './providers/provider.registry';
import { QUEUE_INBOUND, type InboundJob } from './queues';

/**
 * Recebe webhooks dos dois providers. Só valida e enfileira — o processamento
 * pesado fica no worker para responder < 1s e nunca perder evento.
 */
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly registry: ProviderRegistry,
    @InjectQueue(QUEUE_INBOUND) private readonly inbound: Queue<InboundJob>,
  ) {}

  /** Handshake de verificação da Meta */
  @Get('meta')
  verifyMeta(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (mode === 'subscribe' && token === env.META_WEBHOOK_VERIFY_TOKEN) return challenge;
    throw new UnauthorizedException();
  }

  @Post('meta')
  @HttpCode(200)
  async meta(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>) {
    this.registry.get('meta').verifyWebhook(headers, req.rawBody ?? Buffer.alloc(0));
    await this.inbound.add('meta', { provider: 'meta', body: req.body }, { removeOnComplete: 1000, removeOnFail: 5000 });
    return { ok: true };
  }

  @Post('evolution')
  @HttpCode(200)
  async evolution(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>) {
    this.registry.get('evolution').verifyWebhook(headers, req.rawBody ?? Buffer.alloc(0));
    await this.inbound.add('evolution', { provider: 'evolution', body: req.body }, { removeOnComplete: 1000, removeOnFail: 5000 });
    return { ok: true };
  }
}
