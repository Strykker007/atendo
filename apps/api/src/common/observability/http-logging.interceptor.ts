import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { AppLogger } from './app-logger';
import { enrichContext } from './request-context';
import type { AuthUser } from '../../modules/auth/current-user.decorator';

/**
 * Uma linha por requisição atendida, com duração. Roda depois dos guards, então já
 * conhece o usuário — é aqui que tenant/usuário entram no contexto dos demais logs.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly log = new AppLogger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const started = Date.now();

    if (req.user) enrichContext({ tenantId: req.user.tenantId, userId: req.user.id, impersonatorId: req.user.impersonatorId });

    const write = () => {
      const ms = Date.now() - started;
      const line = `${req.method} ${req.route?.path ?? req.originalUrl.split('?')[0]} ${res.statusCode} ${ms}ms`;
      const meta = { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, durationMs: ms };
      // /health é chamado pelo Docker a cada 15s: só em debug, para não poluir o log
      if (req.originalUrl.startsWith('/health')) this.log.debug(line, meta);
      else if (res.statusCode >= 500) this.log.error(line, meta);
      else this.log.log(line, meta);
    };

    return next.handle().pipe(tap({ next: write, error: write }));
  }
}
