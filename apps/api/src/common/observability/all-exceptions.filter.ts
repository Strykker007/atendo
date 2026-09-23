import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppLogger } from './app-logger';
import { currentContext } from './request-context';
import { captureError } from './sentry';

/**
 * Último filtro: garante que nenhum erro saia sem log e sem `requestId` na resposta.
 * Erros 4xx são esperados (validação, permissão) e ficam em warn; 5xx viram error e vão para o Sentry.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new AppLogger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const requestId = currentContext()?.requestId;

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttp ? exception.getResponse() : { statusCode: status, message: 'Erro interno. Tente novamente.' };
    const body = typeof payload === 'string' ? { statusCode: status, message: payload } : { ...(payload as object) };

    const where = `${req.method} ${req.originalUrl.split('?')[0]}`;
    if (status >= 500) {
      this.log.error(`${where} → ${status}`, exception instanceof Error ? exception.stack : String(exception), { status });
      captureError(exception, { path: where, status });
    } else {
      this.log.warn(`${where} → ${status}: ${describe(payload)}`, { status });
    }

    res.status(status).json({ ...body, requestId });
  }
}

function describe(payload: unknown) {
  if (typeof payload === 'string') return payload;
  const m = (payload as { message?: unknown })?.message;
  return Array.isArray(m) ? m.join('; ') : String(m ?? '');
}
