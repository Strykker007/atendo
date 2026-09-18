import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env';
import { RedisIoAdapter } from './common/socket-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // webhooks precisam do corpo bruto para validar assinatura HMAC da Meta
    rawBody: true,
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
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  Logger.log(`API em ${env.API_PUBLIC_URL}`, 'Bootstrap');
}
bootstrap();
