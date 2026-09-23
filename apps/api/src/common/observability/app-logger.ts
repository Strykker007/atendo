import type { LoggerService, LogLevel } from '@nestjs/common';
import { env } from '../../config/env';
import { currentContext } from './request-context';

const ORDER = { debug: 10, log: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof ORDER;

const COLOR: Record<Level, string> = { debug: '\x1b[90m', log: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

/**
 * Logger da aplicação. Em produção escreve **uma linha JSON por evento** (para o agregador
 * de logs filtrar por requestId/tenantId); em desenvolvimento escreve legível no terminal.
 * O `requestId` vem do AsyncLocalStorage, então não é preciso passá-lo em cada chamada.
 */
export interface LoggerOptions {
  level?: Level;
  format?: 'json' | 'pretty';
}

export class AppLogger implements LoggerService {
  private readonly min: number;
  private readonly json: boolean;

  /** `options` existe para teste e para casos especiais; o padrão vem de LOG_LEVEL/LOG_FORMAT. */
  constructor(
    private readonly context?: string,
    private readonly options: LoggerOptions = {},
  ) {
    this.min = ORDER[options.level ?? (env.LOG_LEVEL as Level)] ?? ORDER.log;
    this.json = (options.format ?? env.LOG_FORMAT) === 'json';
  }

  /** Logger dedicado a um contexto (ex.: um processor de fila). */
  child(context: string) {
    return new AppLogger(context, this.options);
  }

  log(message: unknown, ...rest: unknown[]) { this.write('log', message, rest); }
  error(message: unknown, ...rest: unknown[]) { this.write('error', message, rest); }
  warn(message: unknown, ...rest: unknown[]) { this.write('warn', message, rest); }
  debug(message: unknown, ...rest: unknown[]) { this.write('debug', message, rest); }
  verbose(message: unknown, ...rest: unknown[]) { this.write('debug', message, rest); }
  setLogLevels(_: LogLevel[]) { /* nível vem de LOG_LEVEL */ }

  private write(level: Level, message: unknown, rest: unknown[]) {
    if (ORDER[level] < this.min) return;

    // Nest chama logger.error(mensagem, stack, contexto) e logger.log(mensagem, contexto)
    let context = this.context;
    let stack: string | undefined;
    const extras: Record<string, unknown> = {};
    for (const item of rest) {
      if (typeof item === 'string') {
        if (item.includes('\n') || item.startsWith('Error')) stack ??= item;
        else context = item;
      } else if (item instanceof Error) {
        stack ??= item.stack;
      } else if (item && typeof item === 'object') {
        Object.assign(extras, item);
      }
    }
    if (message instanceof Error) {
      stack ??= message.stack;
      message = message.message;
    }

    const ctx = currentContext();
    const entry = {
      time: new Date().toISOString(),
      level,
      msg: typeof message === 'string' ? message : JSON.stringify(message),
      context,
      requestId: ctx?.requestId,
      tenantId: ctx?.tenantId,
      userId: ctx?.userId,
      job: ctx?.job,
      ...extras,
      stack,
    };

    const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    if (this.json) {
      out.write(JSON.stringify(entry) + '\n');
      return;
    }
    const extraKeys = Object.keys(extras);
    const suffix = extraKeys.length ? ' ' + JSON.stringify(extras) : '';
    const tag = ctx?.requestId ? ` \x1b[90m#${ctx.requestId.slice(0, 8)}${RESET}` : '';
    out.write(`${COLOR[level]}${level.toUpperCase().padEnd(5)}${RESET} ${entry.time.slice(11, 19)}${tag} ${context ? `[${context}] ` : ''}${entry.msg}${suffix}\n`);
    if (stack) out.write(`\x1b[90m${stack}${RESET}\n`);
  }
}

/** Instância usada no bootstrap (antes de existir injeção de dependência). */
export const rootLogger = new AppLogger();
