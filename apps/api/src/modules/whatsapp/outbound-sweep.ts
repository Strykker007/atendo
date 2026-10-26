import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { resolveSendLimits, type SendLimits, type SendProvider } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { ConversationsService } from '../conversations/conversations.service';
import { QUEUE_OUTBOUND, type OutboundJob } from './queues';
import { enqueueOutbound, outboundJobId, removeOutboundJob } from './send-queue';

/**
 * Varredura da fila de envio (docs/envio.md#mensagem-sem-job): mensagem `pending` no banco sem job
 * vivo na fila nunca sai — o painel mostra o relógio para sempre. Acontece quando o Redis recusa a
 * gravação do job (26/10/2026: Redis cheio, 18 mensagens de atendentes paradas desde as 8h20, achadas
 * à mão e corrigidas com SQL em produção). A cada minuto, quem estiver nessa situação volta para a
 * fila; quem já passou do prazo da fila vira "não enviada" com aviso, como a expiração normal.
 */

/** Tempo entre gravar a mensagem e enfileirar: antes disso a falta do job é corrida, não órfã. */
export const SWEEP_GRACE_MS = 2 * 60_000;
/** Por rodada: a varredura não pode virar um pico de banco se algo grande der errado. */
export const SWEEP_BATCH = 500;
export const ORPHAN_EXPIRED_REASON = 'Não enviada: a mensagem ficou fora da fila de envio. Envie de novo se ainda fizer sentido.';

/** Estados do BullMQ em que o job ainda vai rodar. Fora deles (ou sem job), a mensagem está órfã. */
const VIVO = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

export type SweepAction = 'ok' | 'requeue' | 'expire';

/** Decisão pura (testada em test/outbound-sweep.test.ts). `jobState` null = não há job. */
export function sweepAction(i: { now: number; createdAt: Date; queuedAt: Date; jobState: string | null; maxQueueAgeMin: number }): SweepAction {
  if (i.now - i.createdAt.getTime() < SWEEP_GRACE_MS) return 'ok';
  if (i.jobState && VIVO.has(i.jobState)) return 'ok';
  // o prazo conta como na fila: do `queuedAt` (segurada pela proteção = no futuro, ainda no prazo)
  return i.now - i.queuedAt.getTime() > i.maxQueueAgeMin * 60_000 ? 'expire' : 'requeue';
}

@Injectable()
export class OutboundSweeper {
  private readonly log = new Logger(OutboundSweeper.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_OUTBOUND) private readonly queue: Queue<OutboundJob>,
    private readonly gateway: ConversationsGateway,
    private readonly conversations: ConversationsService,
  ) {}

  async run(now = Date.now()) {
    const pendentes = await this.prisma.message.findMany({
      where: { direction: 'out', status: 'pending', internal: false, deletedAt: null, createdAt: { lt: new Date(now - SWEEP_GRACE_MS) } },
      orderBy: { createdAt: 'asc' },
      take: SWEEP_BATCH,
      select: { id: true, queueSeq: true, createdAt: true, queuedAt: true, internal: true, numberId: true, conversation: { select: { tenantId: true, numberId: true } } },
    });
    // o prazo da fila é do número (limites da conexão); mensagens antigas sem `numberId` caem no da conversa
    const numIds = [...new Set(pendentes.map((m) => m.numberId ?? m.conversation.numberId))];
    const numeros = new Map((await this.prisma.whatsAppNumber.findMany({ where: { id: { in: numIds } }, select: { id: true, provider: true, sendLimits: true } })).map((n) => [n.id, n]));
    let requeued = 0;
    let expired = 0;
    for (const m of pendentes) {
      const job = await this.queue.getJob(outboundJobId(m));
      const jobState = job ? await job.getState() : null;
      const n = numeros.get(m.numberId ?? m.conversation.numberId);
      const limits = resolveSendLimits((n?.provider ?? 'evolution') as SendProvider, n?.sendLimits as Partial<SendLimits> | null);
      const action = sweepAction({ now, createdAt: m.createdAt, queuedAt: m.queuedAt, jobState, maxQueueAgeMin: limits.maxQueueAgeMin });
      if (action === 'ok') continue;
      if (action === 'requeue') {
        // job terminado com a mensagem ainda pendente: com o mesmo jobId o `add` seria ignorado
        await removeOutboundJob(this.queue, m);
        await enqueueOutbound(this.queue, m);
        requeued++;
        continue;
      }
      // só a que ainda está pendente: se o worker resolveu entre a leitura e aqui, não mexe
      const r = await this.prisma.message.updateMany({ where: { id: m.id, status: 'pending' }, data: { status: 'failed', error: ORPHAN_EXPIRED_REASON } });
      if (r.count) {
        expired++;
        const fresh = await this.prisma.message.findUnique({ where: { id: m.id } });
        if (fresh) this.gateway.emitMessage(m.conversation.tenantId, this.conversations.present(fresh));
      }
    }
    // é o alerta: mensagem órfã só existe quando algo deu errado (Redis cheio, worker caído)
    if (requeued || expired) this.log.warn(`varredura da fila de envio: ${requeued} mensagem(ns) sem job voltaram para a fila, ${expired} marcadas como não enviadas (passaram do prazo)`, { requeued, expired });
    return { checked: pendentes.length, requeued, expired };
  }
}
