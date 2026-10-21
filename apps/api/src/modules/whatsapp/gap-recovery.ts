import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InboundService } from '../conversations/inbound.service';
import { NumbersService } from './numbers.service';
import { QUEUE_HISTORY_MEDIA, type HistoryMediaJob } from './history-sync';
import { QUEUE_GAP_RECOVERY, type GapRecoveryJob } from './queues';

/**
 * Até onde olhar para trás. O lote de histórico do QR traz dias, mas o que interessa é o que
 * aconteceu desde a última vez que o número estava saudável; 24h cobre o pior caso visto
 * (Balneário: travou à noite, QR na manhã seguinte) sem varrer o histórico inteiro a cada reconexão.
 */
const JANELA_MS = 24 * 3_600_000;

/**
 * Recuperação do que o número não recebeu ao vivo (docs/historico-de-mensagens.md#recuperação).
 *
 * Agendada pelo InboundService quando o número reconecta ou volta a receber. Lê do provider tudo o
 * que ele guardou na janela, de todos os chats, e grava o que falta (InboundService.recoverGap).
 * Uma de cada vez: cada rodada lê o banco da Evolution página por página.
 */
@Processor(QUEUE_GAP_RECOVERY, { concurrency: 1 })
export class GapRecoveryProcessor extends TrackedWorkerHost<GapRecoveryJob> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: NumbersService,
    private readonly inbound: InboundService,
    @InjectQueue(QUEUE_HISTORY_MEDIA) private readonly media: Queue<HistoryMediaJob>,
  ) {
    super(QUEUE_GAP_RECOVERY);
  }

  protected async handle(job: Job<GapRecoveryJob>) {
    const number = await this.prisma.whatsAppNumber.findUnique({ where: { id: job.data.numberId } });
    // caiu de novo antes da rodada: a próxima reconexão agenda outra
    if (!number || number.deletedAt || !number.isActive || number.status !== 'connected') return;

    const ate = new Date();
    const desde = new Date(Math.max(ate.getTime() - JANELA_MS, number.createdAt.getTime()));
    const lido = await this.numbers.fetchRecent(number.id, { since: desde, until: ate });
    if (!lido) return;

    const r = await this.inbound.recoverGap(number, lido.messages);
    for (const messageId of r.withMedia) await this.media.add('download', { messageId }, { jobId: `history-media-${messageId}` });
    if (r.recovered || lido.unresolved || lido.truncated) {
      this.log.warn(`Número ${number.label}: ${r.recovered} mensagem(ns) recuperada(s) em ${r.conversations} conversa(s)`
        + (lido.unresolved ? `; ${lido.unresolved} sem telefone (só @lid) ficaram de fora` : '')
        + (lido.truncated ? '; janela maior que o teto de leitura — o resto fica para a próxima rodada' : ''));
    }
  }
}
