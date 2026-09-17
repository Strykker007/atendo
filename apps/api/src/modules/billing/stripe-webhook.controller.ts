import { BadRequestException, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { StripeService } from './stripe.service';

/** Webhook do Stripe. Assinatura verificada no corpo bruto; processamento é rápido (só espelha estado). */
@SkipThrottle()
@Controller('webhooks')
export class StripeWebhookController {
  constructor(private readonly stripe: StripeService) {}

  @Post('stripe')
  @HttpCode(200)
  async handle(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') sig?: string) {
    if (!sig) throw new BadRequestException('stripe-signature ausente');
    const event = this.stripe.constructEvent(req.rawBody ?? Buffer.alloc(0), sig);
    await this.stripe.handle(event);
    return { received: true };
  }
}
