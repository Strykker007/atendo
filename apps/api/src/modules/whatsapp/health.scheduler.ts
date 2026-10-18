import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumbersService } from './numbers.service';
import { ProviderRegistry } from './providers/provider.registry';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import { QUEUE_OUTBOUND, type OutboundJob } from './queues';
import { resumeNumber } from './send-queue';
import { isReceiveStalled, isSilentTooLong, silenceVsLastWeek, unackedSinceLastSignal } from './receive-stall';
import type { NumberStatus } from '@prisma/client';
import { ConnectionEventsService } from './connection-events';
import { SessionProbe, shouldProbe } from './session-probe';

/** números conferidos em paralelo: cada chamada à Evolution tem prazo de 15 s (evolution.provider.ts) */
const HEALTH_CONCURRENCY = 5;

export const QUEUE_HEALTH = 'wa-health';

/** A cada 5 min confere no provider se cada número ativo continua conectado e corrige o status no banco. */
@Injectable()
export class NumbersHealthScheduler implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_HEALTH) private readonly queue: Queue) {}
  async onModuleInit() {
    await this.queue.upsertJobScheduler('numbers-health', { every: 5 * 60_000 }, { name: 'check' });
  }
}

@Processor(QUEUE_HEALTH)
export class NumbersHealthProcessor extends TrackedWorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: NumbersService,
    private readonly registry: ProviderRegistry,
    private readonly gateway: ConversationsGateway,
    @InjectQueue(QUEUE_OUTBOUND) private readonly outbound: Queue<OutboundJob>,
    private readonly connectionEvents: ConnectionEventsService,
    private readonly probe: SessionProbe,
  ) {
    super(QUEUE_HEALTH);
  }
  protected async handle(_job: Job) {
    // `pending_qr` entra também: depois de um reinício a Evolution manda 'connecting' e às vezes não
    // manda o 'open' (ou ele chega antes) — o número fica conectado de verdade e o painel preso em
    // "aguardando QR". Nele só promove para `connected`: com o QR na tela o estado é 'connecting'.
    const list = await this.prisma.whatsAppNumber.findMany({ where: { isActive: true, deletedAt: null } });
    // em paralelo, com teto: em série, uma Evolution travada (15 s por número) passava dos 5 min do ciclo
    const queue = [...list];
    const run = async () => {
      for (let n = queue.shift(); n; n = queue.shift()) await this.checkNumber(n);
    };
    await Promise.all(Array.from({ length: Math.min(HEALTH_CONCURRENCY, list.length) }, run));
  }

  private async checkNumber(n: Awaited<ReturnType<PrismaService['whatsAppNumber']['findMany']>>[number]) {
    try {
      const ctx = await this.numbers.context(n.id);
      const provider = this.registry.get(n.provider);
      const status = await provider.getStatus(ctx);
      if (n.status === 'pending_qr' && status !== 'connected') return;
      if (status !== n.status) {
        await this.prisma.whatsAppNumber.update({ where: { id: n.id }, data: { status } });
        // estado real lido agora: webhook de conexão que chegou antes disto é mais velho (connection-events.ts)
        await this.connectionEvents.markHealthCorrection(n.id);
        this.gateway.emitNumber(n.tenantId, { id: n.id, status });
        this.log.warn(`Número ${n.label}: ${n.status} → ${status}`);
        // voltou sem passar pelo webhook de conexão: retoma a fila parada do número
        if (status === 'connected') await resumeNumber(this.prisma, this.outbound, n.id);
      }
      const silence = n.provider === 'evolution' && status === 'connected' ? await silenceVsLastWeek(this.prisma, n.id, n.sessionStartedAt) : null;
      await this.checkReceiving(n, status, silence);
      // "conectado" e quieto: o socket ainda responde? Só registra e avisa — nunca reinicia (docs/28)
      if (silence && provider.probe && shouldProbe(silence.silentMs)) await this.probe.check(n, () => provider.probe!(ctx));
      else if (status !== 'connected') await this.probe.clear(n.id);
    } catch (err) {
      this.log.warn(`health ${n.label}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Conectado, mas recebendo nada (receive-stall.ts). Só Conexão Web: é lá que as chaves de
   * recebimento corrompem sem derrubar a sessão. Marca e desmarca sozinho — ler o QR de novo
   * muda `sessionStartedAt`, e as mensagens de antes deixam de contar.
   */
  private async checkReceiving(n: { id: string; tenantId: string; label: string; provider: string; sessionStartedAt: Date | null; receiveStalledAt: Date | null }, status: NumberStatus, silence: { silentMs: number | null; expected: number } | null) {
    let stalled = false;
    if (silence) {
      const unacked = await unackedSinceLastSignal(this.prisma, n.id, n.sessionStartedAt);
      if (n.receiveStalledAt) {
        // já marcado: só desmarca com sinal de vida DEPOIS da marcação (ou QR novo). Reavaliar as
        // regras aqui fazia o aviso piscar — some, volta na hora seguinte — mesmo resolvido ou não
        const ultimoSinal = silence.silentMs === null ? null : Date.now() - silence.silentMs;
        const sessaoNova = !!n.sessionStartedAt && n.sessionStartedAt > n.receiveStalledAt;
        stalled = !sessaoNova && !(ultimoSinal !== null && ultimoSinal > n.receiveStalledAt.getTime());
      } else {
        // silêncio sozinho (loja parada, feriado) não basta: precisa de ao menos uma enviada sem confirmação
        stalled = isReceiveStalled(unacked) || (unacked.unacked >= 1 && isSilentTooLong(silence));
      }
    }
    if (stalled === !!n.receiveStalledAt) return;
    await this.prisma.whatsAppNumber.update({ where: { id: n.id }, data: { receiveStalledAt: stalled ? new Date() : null } });
    this.gateway.emitNumber(n.tenantId, { id: n.id, status });
    if (stalled) this.log.warn(`Número ${n.label}: envia mas não recebe nem confirma entrega — precisa ler o QR de novo`);
    else this.log.log(`Número ${n.label}: voltou a receber`);
  }
}
