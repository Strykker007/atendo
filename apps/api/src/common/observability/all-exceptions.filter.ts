import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

    // P2025 = "registro não encontrado", o que o Prisma lança em findFirstOrThrow, update e
    // delete. São 44 chamadas espalhadas pelo código; sem esta tradução cada uma vira 500 e
    // vai para o Sentry como se fosse defeito, quando é só um id que não existe.
    const error = exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025'
      ? new NotFoundException('Não encontrado')
      : exception;

    const isHttp = error instanceof HttpException;
    const status = isHttp ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttp ? error.getResponse() : { statusCode: status, message: 'Erro interno. Tente novamente.' };
    const body = typeof payload === 'string' ? { statusCode: status, message: payload } : { ...(payload as object) };

    const where = `${req.method} ${req.originalUrl.split('?')[0]}`;
    if (status >= 500) {
      this.log.error(`${where} → ${status}`, error instanceof Error ? error.stack : String(error), { status });
      captureError(error, { path: where, status });
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
