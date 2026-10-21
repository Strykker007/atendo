import { Controller, Get, Headers, Post, Query, Req, HttpCode, UnauthorizedException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { env } from '../../config/env';
import { ProviderRegistry } from './providers/provider.registry';
import { QUEUE_INBOUND, type InboundJob } from './queues';
import { hasGroupEvent, stripGroupEvents } from './group-filter';
import { GroupInboxRegistry } from './group-inbox';

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
    private readonly groupInbox: GroupInboxRegistry,
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
    // grupo nunca abre atendimento (docs/grupos.md): descarta aqui, antes de fila, banco e log.
    // Só passa o grupo marcado "Mostrar nas conversas" — lista em memória, buscada só quando o
    // corpo traz algo de grupo
    const instance = typeof req.body?.instance === 'string' ? req.body.instance : '';
    const inbox = hasGroupEvent(req.body) ? await this.groupInbox.allowed(instance) : undefined;
    const body = stripGroupEvents(req.body, inbox);
    if (!body) return { ok: true };
    // eventos de contato chegam junto da mensagem que os originou (com o pushName dela); o
    // atraso garante que a mensagem já esteja gravada quando o nome for avaliado — a fila roda
    // em paralelo e, sem isso, o pushName passava por nome da agenda
    const ev = (body as { event?: string })?.event;
    const delay = ev === 'contacts.upsert' || ev === 'contacts.update' ? 30_000 : undefined;
    await this.inbound.add('evolution', { provider: 'evolution', body, receivedAt: Date.now() }, { removeOnComplete: 1000, removeOnFail: 5000, delay });
    return { ok: true };
  }
}
