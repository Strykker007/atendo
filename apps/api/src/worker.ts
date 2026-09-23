import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { AppLogger, rootLogger } from './common/observability/app-logger';
import { captureError, flushSentry, initSentry } from './common/observability/sentry';
import { env } from './config/env';

// Processo separado da API HTTP: consome filas (envio, webhooks, reconciliação de uso).
async function bootstrap() {
  const sentry = initSentry('worker');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: new AppLogger() });
  app.enableShutdownHooks();
  rootLogger.log('Worker iniciado', 'Worker', { logFormat: env.LOG_FORMAT, sentry });
}

for (const signal of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(signal, async (err: unknown) => {
    rootLogger.error(`${signal}`, err instanceof Error ? err.stack : String(err), 'Worker');
    captureError(err, { signal });
    await flushSentry();
    process.exit(1);
  });
}

bootstrap();
