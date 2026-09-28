import { WorkerHost } from '@nestjs/bullmq';
import { DelayedError, type Job } from 'bullmq';
import { AppLogger } from './app-logger';
import { runWithContext } from './request-context';
import { captureError } from './sentry';

/**
 * Base dos processors de fila. Abre um contexto por job (para o log sair com fila/job/tenant),
 * mede a duração e garante que **nenhuma falha de job passe despercebida** — o BullMQ
 * engole o erro depois de logar, e sem isto um envio que falha some.
 *
 * Quem herda implementa `handle` no lugar de `process`.
 */
export abstract class TrackedWorkerHost<T = unknown, R = unknown> extends WorkerHost {
  protected readonly log: AppLogger;

  protected constructor(private readonly queue: string) {
    super();
    this.log = new AppLogger(new.target.name);
  }

  async process(job: Job<T>, token?: string): Promise<R> {
    return runWithContext({ job: { queue: this.queue, name: job.name, id: job.id } }, async () => {
      const started = Date.now();
      try {
        const result = await this.handle(job, token);
        this.log.debug(`${this.queue}:${job.name} ok`, { durationMs: Date.now() - started, attempt: job.attemptsMade + 1 });
        return result;
      } catch (err) {
        // job reagendado de propósito (ritmo de envio): não é falha
        if (err instanceof DelayedError) throw err;
        const last = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        this.log.error(
          `${this.queue}:${job.name} falhou (tentativa ${job.attemptsMade + 1}${last ? ', última' : ''})`,
          err instanceof Error ? err.stack : String(err),
          { durationMs: Date.now() - started, jobId: job.id, willRetry: !last },
        );
        // só reporta quando não há mais retry: erro transitório reprocessado com sucesso não é incidente
        if (last) captureError(err, { queue: this.queue, job: job.name, jobId: job.id });
        throw err;
      }
    });
  }

  protected abstract handle(job: Job<T>, token?: string): Promise<R>;
}
