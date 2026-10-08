import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env, webOrigins } from './config/env';
import { RedisIoAdapter } from './common/socket-io.adapter';
import { AppLogger, rootLogger } from './common/observability/app-logger';
import { captureError, flushSentry, initSentry } from './common/observability/sentry';

async function bootstrap() {
  const sentry = initSentry('api');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // webhooks precisam do corpo bruto para validar assinatura HMAC da Meta
    rawBody: true,
    logger: new AppLogger(),
  });
  // webhooks da Evolution podem vir com mídia em base64 — o padrão do Express (100kb) dava 413
  app.useBodyParser('json', { limit: '30mb' });
  app.useBodyParser('urlencoded', { limit: '30mb', extended: true });
  // atrás de load balancer / proxy: IP real do cliente (throttling, auditoria) e cookies secure
  app.set('trust proxy', 1);
  // Socket.IO compartilhado entre réplicas via Redis
  const io = new RedisIoAdapter(app);
  await io.connect();
  app.useWebSocketAdapter(io);

  // CORP 'same-origin' (padrão do helmet) impediria <img src="http://api/media/..."> na web em outra origem
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({ origin: webOrigins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  rootLogger.log(`API em ${env.API_PUBLIC_URL}`, 'Bootstrap', { port: env.API_PORT, logFormat: env.LOG_FORMAT, sentry });
}

// erro fora de qualquer requisição: registra, avisa o Sentry e sai — deixar de pé um
// processo em estado desconhecido é pior do que o orquestrador reiniciar.
for (const signal of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(signal, async (err: unknown) => {
    rootLogger.error(`${signal}`, err instanceof Error ? err.stack : String(err), 'Bootstrap');
    captureError(err, { signal });
    await flushSentry();
    process.exit(1);
  });
}

bootstrap();
