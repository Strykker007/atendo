import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { newRequestId, runWithContext } from './request-context';

/**
 * Abre o contexto de cada requisição. Aceita o `x-request-id` de quem chamou (proxy,
 * outro serviço) para o mesmo id atravessar os sistemas, e devolve no cabeçalho —
 * o suporte pede esse id ao cliente e acha tudo no log.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    const requestId = (Array.isArray(incoming) ? incoming[0] : incoming)?.slice(0, 64) || newRequestId();
    res.setHeader('x-request-id', requestId);
    runWithContext({ requestId }, () => next());
  }
}
