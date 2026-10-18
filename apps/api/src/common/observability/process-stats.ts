import { monitorEventLoopDelay } from 'node:perf_hooks';
import type Redis from 'ioredis';

/**
 * Amostra de memória e atraso do event loop deste processo, para testes de carga locais
 * (scripts/loadtest.ts, docs/30-testes-locais.md). Desligado por padrão: só com DIAG_STATS_MS > 0.
 * Grava em `diag:stats:<papel>:<pid>` no Redis (expira sozinho) — o script de carga lê de lá.
 */
export function startProcessStats(role: 'api' | 'worker', redis: Pick<Redis, 'set'>, intervalMs: number) {
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  const ms = (ns: number) => Math.round((ns / 1e6) * 10) / 10;
  const timer = setInterval(() => {
    const m = process.memoryUsage();
    const sample = {
      role, pid: process.pid, at: new Date().toISOString(),
      rssMb: Math.round(m.rss / 1048576), heapUsedMb: Math.round(m.heapUsed / 1048576),
      eventLoopP50Ms: ms(h.percentile(50)), eventLoopP99Ms: ms(h.percentile(99)), eventLoopMaxMs: ms(h.max),
    };
    h.reset();
    redis.set(`diag:stats:${role}:${process.pid}`, JSON.stringify(sample), 'EX', Math.max(5, Math.ceil((intervalMs * 3) / 1000))).catch(() => undefined);
  }, intervalMs);
  timer.unref();
  return () => { clearInterval(timer); h.disable(); };
}
