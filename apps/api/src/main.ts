import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // webhooks precisam do corpo bruto para validar assinatura HMAC da Meta
    rawBody: true,
  });

  app.use(helmet());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  Logger.log(`API em ${env.API_PUBLIC_URL}`, 'Bootstrap');
}
bootstrap();
