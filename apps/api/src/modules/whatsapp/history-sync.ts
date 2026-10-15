import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import type { InboundMessage } from '@atendo/shared';
import { TrackedWorkerHost } from '../../common/observability/tracked-worker.host';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';
import { InboundService } from '../conversations/inbound.service';
import { NumbersService } from './numbers.service';
import { ProviderRegistry } from './providers/provider.registry';

export const QUEUE_HISTORY_MEDIA = 'wa-history-media';

export interface HistoryMediaJob {
  messageId: string;
}

/** Provider sem nada mais antigo: não pergunta de novo por um tempo. */
const FIM_TTL_S = 3 * 86_400;
/** Uma sincronização por conversa por vez (duas abas, dois atendentes). */
const TRAVA_MS = 20_000;
/** Quantas buscas ao provider por pedido, quando um lote vem só com o que não vira bolha (reações, edições). */
const RODADAS = 3;
/** O atendente está esperando a tela: passado disso, mostra o que já tem. */
const PRAZO_MS = 8_000;

const fimKey = (conversationId: string) => `wa:history:end:${conversationId}`;
const travaKey = (conversationId: string) => `wa:history:lock:${conversationId}`;

/**
 * Traz do provider as mensagens anteriores à mais antiga que o painel tem, conforme o atendente
 * rola a conversa para cima (docs/historico-de-mensagens.md). Só a Evolution guarda histórico.
 */
@Injectable()
export class HistorySyncService {
  private readonly log = new Logger(HistorySyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly numbers: NumbersService,
    private readonly inbound: InboundService,
    @InjectQueue(QUEUE_HISTORY_MEDIA) private readonly media: Queue<HistoryMediaJob>,
  ) {}

  /**
   * Busca até `want` mensagens anteriores e grava. Nunca lança nem passa do prazo: histórico é
   * complemento, a conversa tem que abrir mesmo com a Evolution fora do ar. Devolve quantas entraram.
   */
  async syncOlder(tenantId: string, conversationId: string, want: number): Promise<number> {
    if (await this.redis.exists(fimKey(conversationId))) return 0;
    if ((await this.redis.set(travaKey(conversationId), '1', 'PX', TRAVA_MS, 'NX')) !== 'OK') return 0;
    // passou do prazo: a busca termina em segundo plano (a próxima rolagem já encontra o que
    // entrou) e só ela solta a trava — senão outra rodada começaria junto
    const busca = this.run(tenantId, conversationId, want)
      .catch((err) => {
        this.log.warn(`histórico da conversa ${conversationId}: ${err instanceof Error ? err.message : err}`);
        return 0;
      })
      .finally(() => this.redis.del(travaKey(conversationId)).catch(() => undefined));
    let prazo: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([busca, new Promise<number>((resolve) => (prazo = setTimeout(() => resolve(0), PRAZO_MS)))]);
    } finally {
      clearTimeout(prazo);
    }
  }

  private async run(tenantId: string, conversationId: string, want: number) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { id: true, tenantId: true, numberId: true, contact: { select: { phone: true } } },
    });
    if (!conv?.numberId) return 0;
    // histórico apagado no painel: trazer de volta o que veio antes desfaria a decisão de quem apagou
    const apagado = await this.prisma.conversationEvent.findFirst({ where: { conversationId, type: 'history_cleared' }, select: { id: true } });
    if (apagado) {
      await this.redis.set(fimKey(conversationId), '1', 'EX', FIM_TTL_S);
      return 0;
    }

    const [maisAntiga, conhecidas] = await Promise.all([
      this.prisma.message.findFirst({ where: { conversationId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      // uma recebida e uma enviada: o provider descobre por elas como gravou o chat
      Promise.all((['in', 'out'] as const).map((direction) =>
        this.prisma.message.findFirst({ where: { conversationId, direction, externalId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { externalId: true } }),
      )),
    ]);
    const knownExternalIds = conhecidas.map((m) => m?.externalId).filter((id): id is string => !!id);

    let before = maisAntiga?.createdAt ?? new Date();
    let imported = 0;
    for (let rodada = 0; rodada < RODADAS && imported < want; rodada++) {
      const page = await this.numbers.fetchHistory(conv.numberId, { phone: conv.contact.phone, before, limit: want - imported, knownExternalIds });
      if (!page) {
        await this.redis.set(fimKey(conversationId), '1', 'EX', FIM_TTL_S);
        break;
      }
      const r = await this.inbound.importHistory({ id: conv.id, tenantId: conv.tenantId, numberId: conv.numberId }, page.messages);
      imported += r.imported;
      for (const messageId of r.withMedia) await this.media.add('download', { messageId }, { jobId: `history-media-${messageId}` });
      if (page.exhausted) {
        await this.redis.set(fimKey(conversationId), '1', 'EX', FIM_TTL_S);
        break;
      }
      // sem avanço (lote todo de reação/edição): continua de onde o provider parou
      if (!page.oldest || page.oldest.getTime() >= before.getTime()) break;
      before = page.oldest;
    }
    if (imported) this.log.log(`histórico: ${imported} mensagem(ns) anteriores importadas na conversa ${conversationId}`);
    return imported;
  }
}

/**
 * Mídia do histórico, uma por vez e fora da requisição. Mídia antiga pode já ter saído do
 * servidor do WhatsApp: aí a bolha fica "indisponível", igual a uma recebida que falhou.
 */
@Processor(QUEUE_HISTORY_MEDIA, { concurrency: 2 })
export class HistoryMediaProcessor extends TrackedWorkerHost<HistoryMediaJob> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: NumbersService,
    private readonly registry: ProviderRegistry,
    private readonly storage: StorageService,
    private readonly inbound: InboundService,
  ) {
    super(QUEUE_HISTORY_MEDIA);
  }

  protected async handle(job: Job<HistoryMediaJob>) {
    const m = await this.prisma.message.findUnique({
      where: { id: job.data.messageId },
      select: { id: true, numberId: true, mediaUrl: true, mediaMime: true, mediaName: true, raw: true, conversation: { select: { tenantId: true } } },
    });
    if (!m?.numberId || m.mediaUrl) return;
    const tenantId = m.conversation.tenantId;
    try {
      const ctx = await this.numbers.context(m.numberId);
      // o provider só lê a mídia e o payload cru (key) — o resto do InboundMessage não importa aqui
      const msg = { media: { mimeType: m.mediaMime ?? undefined, fileName: m.mediaName ?? undefined }, raw: m.raw } as unknown as InboundMessage;
      const media = await this.registry.get(ctx.provider).fetchMedia(ctx, msg);
      if (!media) throw new Error('o provider não devolveu o arquivo');
      const key = this.storage.makeKey(tenantId, media.mimeType, media.fileName);
      await this.storage.put(key, media.data, media.mimeType);
      await this.inbound.attachMedia(m.id, tenantId, key, media.mimeType, media.fileName);
    } catch (err) {
      await this.inbound.mediaFailed(m.id, tenantId, err instanceof Error ? err.message : String(err));
    }
  }
}
