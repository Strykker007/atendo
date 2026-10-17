import { Injectable } from '@nestjs/common';
import { resolveSendLimits, MessageType, type OutboundMessage, type SendLimits, type SendProvider } from '@atendo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AppLogger } from '../../common/observability/app-logger';
import { UsageService } from '../billing/usage.service';
import { NumbersService } from '../whatsapp/numbers.service';
import { ProviderRegistry } from '../whatsapp/providers/provider.registry';
import { SendPacer } from '../whatsapp/send-pacer';
import { humanTiming, typingMs, warmupPhase } from '../whatsapp/number-warmup';

type MediaType = 'image' | 'document' | 'audio' | 'video';

export interface GroupSendInput {
  tenantId: string;
  numberId: string;
  target: { id: string; group: { id: string; jid: string; authorized: boolean } };
  text?: string;
  media?: { key: string; type: MediaType; name?: string };
}

/** `sent`/`failed` = alvo processado; `wait` = as travas pediram para esperar (o alvo continua pendente). */
export type GroupSendResult = { status: 'sent'; externalId: string } | { status: 'failed'; error: string } | { status: 'wait'; retryInMs: number; reason: string };

/** acima disto, em vez de segurar o worker, a transmissão volta para a fila */
const MAX_INLINE_WAIT_MS = 30_000;

/**
 * Envio de transmissão para GRUPO autorizado (docs/grupos.md). Grupo não é contato nem tem
 * conversa, então não passa pela fila de saída (que é por conversa) — mas aplica as MESMAS
 * travas dela, na mesma ordem: cota do plano, teto proativo do dia, aquecimento da sessão,
 * ritmo do número (`SendPacer.reserve`, automático) e o ledger (`UsageService.record`).
 * O intervalo de 20–60 s, o horário comercial e o teto de transmissão por 24h ficam no
 * despachante da campanha, igual aos contatos.
 */
@Injectable()
export class GroupSender {
  private readonly log = new AppLogger('GroupSender');

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: NumbersService,
    private readonly registry: ProviderRegistry,
    private readonly pacer: SendPacer,
    private readonly usage: UsageService,
    private readonly storage: StorageService,
  ) {}

  async send(i: GroupSendInput): Promise<GroupSendResult> {
    // desautorizado depois de criada a transmissão: não envia
    if (!i.target.group.authorized) return { status: 'failed', error: 'Grupo não está mais autorizado para transmissões.' };

    const num = await this.prisma.whatsAppNumber.findUniqueOrThrow({
      where: { id: i.numberId },
      select: { id: true, tenantId: true, provider: true, status: true, sendDelay: true, sendDailyLimit: true, warmupStartedAt: true, sendLimits: true, sessionStartedAt: true },
    });
    if (num.tenantId !== i.tenantId) return { status: 'failed', error: 'Número de outro cliente — envio bloqueado' };
    if (num.provider === 'meta') return { status: 'failed', error: 'A API oficial não envia para grupos.' };

    const quota = await this.usage.canSend(i.tenantId, 'messages', num.id);
    if (!quota.ok) return { status: 'failed', error: quota.reason ?? 'Cota de mensagens do plano atingida' };

    const day = await this.pacer.dailyStatus(num);
    if (!day.ok) return { status: 'wait', retryInMs: 15 * 60_000, reason: day.reason ?? 'teto do dia' };

    const limits = resolveSendLimits(num.provider as SendProvider, num.sendLimits as Partial<SendLimits> | null);
    const convKey = `group:${i.target.group.id}`;
    const aquecendo = warmupPhase(num);
    if (aquecendo) {
      const wait = await this.pacer.claimWarmupConversation(num.id, convKey, aquecendo.newConvPerHour);
      if (wait > 0) return { status: 'wait', retryInMs: wait, reason: `número aquecendo (fase ${aquecendo.phase})` };
    }
    const ritmo = aquecendo ? { ...limits, autoPerHour: Math.min(limits.autoPerHour, aquecendo.autoPerHour) } : limits;
    const { waitMs } = await this.pacer.reserve({ numberId: num.id, conversationId: convKey, messageId: i.target.id, profile: num.sendDelay, limits: ritmo, automated: true, provider: num.provider, warmupGapMs: aquecendo?.minGapMs });
    if (waitMs > MAX_INLINE_WAIT_MS) return { status: 'wait', retryInMs: waitMs, reason: 'ritmo do número' };
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

    const ctx = await this.numbers.context(num.id);
    const provider = this.registry.get(ctx.provider);
    const text = i.text?.trim() || undefined;
    const outbound: OutboundMessage = {
      to: i.target.group.jid,
      type: i.media ? (i.media.type as MessageType) : MessageType.TEXT,
      text,
      media: i.media ? { url: i.media.key, fileName: i.media.name, caption: text } : undefined,
      // humanização igual ao automático da fila: "digitando…" pelo tempo do texto
      typingMs: text ? humanTiming(text.length).typingMs : typingMs(0),
    };

    let result;
    try {
      await this.numbers.markOnline(num.id);
      const media = i.media ? { ...(await this.storage.get(i.media.key)), fileName: i.media.name } : undefined;
      result = await provider.send(ctx, outbound, media);
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }

    // entregue: daqui em diante nada pode virar falha (reenviaria ao grupo)
    await this.pacer.countSend(num.id).catch(() => undefined);
    await this.pacer.delivered({ numberId: num.id, conversationId: convKey, profile: num.sendDelay, limits }).catch(() => undefined);
    await this.usage
      .record({ tenantId: i.tenantId, numberId: num.id, messageId: null, provider: ctx.provider, direction: 'out', billingCategory: result.billingCategory })
      .catch((err) => this.log.error(`Uso não registrado para o grupo ${i.target.group.id} (mensagem foi entregue): ${err instanceof Error ? err.message : err}`));
    return { status: 'sent', externalId: result.externalId };
  }
}
