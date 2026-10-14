import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { env } from '../../config/env';

/** período máximo de um relatório: mais que isso é exportação, não tela (docs/relatorios-desempenho.md) */
export const REPORT_MAX_DAYS = 400;

/** Recusa período invertido ou maior que `REPORT_MAX_DAYS`. */
export function assertReportRange(from: Date, to: Date) {
  if (!(from < to)) throw new BadRequestException('Período inválido: a data inicial precisa ser antes da final.');
  if (to.getTime() - from.getTime() > REPORT_MAX_DAYS * 86_400_000) throw new BadRequestException(`Período longo demais: o máximo é ${REPORT_MAX_DAYS} dias.`);
}

/**
 * Protege o banco dos relatórios (docs/relatorios-desempenho.md).
 *
 * A visão pronta de Relatórios dispara ~20 consultas de uma vez. O pool do Prisma tem poucas
 * conexões (núcleos × 2 + 1), então UMA pessoa abrindo a tela ocupava todas e o chat — que é o
 * que não pode parar — esperava na fila do pool. Três defesas:
 *
 * - `run`: no máximo `REPORT_MAX_CONCURRENCY` (padrão 3) consultas de relatório ao mesmo tempo
 *   por processo; o resto espera aqui, não no pool. Sobra conexão para o atendimento.
 * - `cached`: resultado guardado por alguns segundos no Redis, por cliente + filtros. Gerente
 *   apertando F5, várias abas abertas e a tela voltando ao foco viram uma consulta só.
 * - single-flight: duas requisições iguais ao mesmo tempo esperam a mesma execução.
 *
 * Fica no CoreModule (global) de propósito: o limite só vale se a instância for uma só.
 */
@Injectable()
export class ReportLoadService {
  private readonly log = new Logger(ReportLoadService.name);
  private readonly max = Math.max(1, env.REPORT_MAX_CONCURRENCY ?? 3);
  private ativos = 0;
  private readonly fila: (() => void)[] = [];
  private readonly emVoo = new Map<string, Promise<unknown>>();

  constructor(private readonly redis: RedisService) {}

  /** Roda uma consulta respeitando o limite de concorrência. Recebe função: a query só começa na vez dela. */
  async run<T>(fn: () => PromiseLike<T>): Promise<T> {
    if (this.ativos >= this.max) await new Promise<void>((ok) => this.fila.push(ok));
    this.ativos++;
    try {
      return await fn();
    } finally {
      this.ativos--;
      this.fila.shift()?.();
    }
  }

  /** `Promise.all` com cada consulta passando pelo limite (o `| []` faz o TS inferir tupla). */
  all<T extends readonly (() => PromiseLike<unknown>)[] | []>(fns: T): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
    return Promise.all(fns.map((f) => this.run(f))) as Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>;
  }

  /**
   * Cache curto (padrão 60 s) + single-flight. `key` precisa conter o tenant e todos os filtros.
   * Redis fora do ar não derruba o relatório: só calcula sem cache.
   */
  async cached<T>(key: string, fn: () => Promise<T>, ttlSec = 60): Promise<T> {
    const k = `report:${key}`;
    const hit = await this.redis.get(k).catch(() => null);
    if (hit) return JSON.parse(hit) as T;
    const voando = this.emVoo.get(k);
    if (voando) return voando as Promise<T>;
    const p = fn()
      .then(async (v) => {
        await this.redis.set(k, JSON.stringify(v), 'EX', ttlSec).catch((err) => this.log.debug(`cache de relatório não gravado: ${err instanceof Error ? err.message : err}`));
        return v;
      })
      .finally(() => this.emVoo.delete(k));
    this.emVoo.set(k, p);
    return p;
  }

  /** Chave estável a partir dos filtros (ordem das chaves não importa). */
  static key(tenantId: string, name: string, q: Record<string, unknown>) {
    const norm = Object.keys(q).sort().filter((k) => q[k] !== undefined && q[k] !== '').map((k) => `${k}=${q[k] instanceof Date ? (q[k] as Date).toISOString() : String(q[k])}`).join('&');
    return `${tenantId}:${name}:${norm}`;
  }
}
