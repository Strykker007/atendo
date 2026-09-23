import * as Sentry from '@sentry/node';
import { env } from '../../config/env';
import { currentContext } from './request-context';

let enabled = false;

/** Liga o Sentry se houver DSN. Sem DSN o projeto roda igual — nada é enviado. */
export function initSentry(processName: 'api' | 'worker') {
  if (!env.SENTRY_DSN || enabled) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.APP_VERSION || undefined,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    initialScope: { tags: { process: processName } },
    // não enviar corpo de requisição/cabeçalhos: passam tokens de provider e dados do contato
    sendDefaultPii: false,
  });
  enabled = true;
  return true;
}

export const sentryEnabled = () => enabled;

/** Envia o erro com o contexto da requisição/job — é o que torna o alerta investigável. */
export function captureError(err: unknown, extra?: Record<string, unknown>) {
  if (!enabled) return;
  const ctx = currentContext();
  Sentry.withScope((scope) => {
    if (ctx?.requestId) scope.setTag('requestId', ctx.requestId);
    if (ctx?.tenantId) scope.setTag('tenantId', ctx.tenantId);
    if (ctx?.userId) scope.setUser({ id: ctx.userId });
    if (ctx?.job) scope.setContext('job', ctx.job);
    if (extra) scope.setContext('extra', extra);
    Sentry.captureException(err);
  });
}

/** Espera o envio das pendências antes do processo morrer. */
export const flushSentry = (ms = 2000) => (enabled ? Sentry.close(ms) : Promise.resolve(true));
