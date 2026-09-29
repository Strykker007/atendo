import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from '../src/worker.module';
import { StripeService } from '../src/modules/billing/stripe.service';

// Cria Product + Price no Stripe para cada plano sem stripePriceId. Idempotente.
//
// Roda COMPILADO (`nest build && node dist/scripts/stripe-sync.js`), não com tsx: o tsx não
// emite `design:paramtypes`, e sem esses metadados a injeção de dependência do Nest não
// resolve nada — o contexto nem sobe.
async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['log', 'warn', 'error'] });
  const stripe = app.get(StripeService);
  if (!stripe.enabled) {
    console.error('STRIPE_SECRET_KEY não configurada no .env');
    process.exit(1);
  }
  await stripe.syncPlans();
  await app.close();
  console.log('Planos sincronizados com o Stripe.');
}
main();
