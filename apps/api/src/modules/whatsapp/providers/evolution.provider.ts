import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { BillingCategory, MessageStatus, MessageType, NumberStatus } from '@atendo/shared';
import type { InboundMessage, OutboundMessage, SendResult, StatusUpdate } from '@atendo/shared';
import { env } from '../../../config/env';
import type { MediaPayload, NumberContext, ParsedWebhook, WhatsAppProvider } from './provider.interface';

/** providerConfig de um número Evolution */
export interface EvolutionNumberConfig {
  instanceName: string;
  /** token da instância (Evolution gera um por instância) */
  instanceToken?: string;
  /**
   * Shard: qual servidor Evolution hospeda esta instância. Vazio = o padrão do .env.
   * Com centenas de números, distribuímos entre vários servidores (cada instância Baileys custa ~100 MB de RAM).
   */
  baseUrl?: string;
  apiKey?: string;
}

/**
 * Evolution API (não-oficial, via QR code). Custo por mensagem = 0.
 * Docs: https://doc.evolution-api.com
 */
@Injectable()
export class EvolutionProvider implements WhatsAppProvider {
  readonly kind = 'evolution' as const;

  private async api<T>(path: string, init?: RequestInit, shard?: { baseUrl?: string; apiKey?: string }): Promise<T> {
    const res = await fetch(`${shard?.baseUrl ?? env.EVOLUTION_BASE_URL}${path}`, {
      ...init,
      headers: { apikey: shard?.apiKey ?? env.EVOLUTION_API_KEY, 'Content-Type': 'application/json', ...init?.headers },
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const raw = json?.response?.message ?? json?.message ?? `Evolution ${res.status}`;
      throw new BadRequestException(Array.isArray(raw) ? raw.join('; ') : String(raw));
    }
    return json as T;
  }

  private shard(ctx: NumberContext) {
    const c = ctx.config as unknown as EvolutionNumberConfig;
    return c.baseUrl ? { baseUrl: c.baseUrl, apiKey: c.apiKey } : undefined;
  }

  private instance(ctx: NumberContext) {
    return (ctx.config as unknown as EvolutionNumberConfig).instanceName ?? ctx.externalId;
  }

  /**
   * Token por instância, derivado da chave global (HMAC). A Evolution devolve esse token
   * no corpo de cada webhook (`apikey`), e assim validamos a origem sem consultar o banco.
   */
  private instanceToken(instanceName: string) {
    return createHmac('sha256', env.EVOLUTION_API_KEY).update(instanceName).digest('hex');
  }

  async connect(ctx: NumberContext) {
    const name = this.instance(ctx);
    // Já conectado? Não mexe: chamar /connect numa sessão aberta cria uma segunda sessão
    // e o WhatsApp derruba a primeira ("conflict: replaced") — envio passa a falhar.
    const state = await this.api<any>(`/instance/connectionState/${name}`, undefined, this.shard(ctx)).catch(() => null);
    if (state?.instance?.state === 'open') return { status: NumberStatus.CONNECTED };
    // 'close' = sessão caiu ou o celular removeu o dispositivo. O usuário pediu QR: descarta
    // as credenciais antigas para a Evolution gerar um pareamento novo em vez de tentar reconectar.
    if (state?.instance?.state === 'close') {
      await this.api(`/instance/logout/${name}`, { method: 'DELETE' }, this.shard(ctx)).catch(() => undefined);
    }

    // cria se não existir; se já existe seguimos direto para o QR
    const created = await this.api<any>('/instance/create', {
      method: 'POST',
      body: JSON.stringify({ instanceName: name, token: this.instanceToken(name), integration: 'WHATSAPP-BAILEYS', qrcode: true, number: ctx.phone }),
    }, this.shard(ctx)).catch((err: Error) => {
      if (/already|in use|já/i.test(err.message)) return null;
      throw err;
    });
    if (created?.qrcode?.base64) return { status: NumberStatus.PENDING_QR, qrCode: created.qrcode.base64 };

    const r = await this.api<any>(`/instance/connect/${name}`, undefined, this.shard(ctx));
    if (r?.instance?.state === 'open') return { status: NumberStatus.CONNECTED };
    return { status: NumberStatus.PENDING_QR, qrCode: r?.base64 ?? r?.code };
  }

  async disconnect(ctx: NumberContext) {
    await this.api(`/instance/logout/${this.instance(ctx)}`, { method: 'DELETE' }, this.shard(ctx)).catch(() => undefined);
  }

  /**
   * Socket zumbi: a Evolution diz "open" mas o WebSocket com o WhatsApp morreu (comum depois
   * de o host dormir) e todo envio dá "Connection Closed". Restart reconecta com as credenciais salvas.
   */
  async restart(ctx: NumberContext) {
    await this.api(`/instance/restart/${this.instance(ctx)}`, { method: 'POST' }, this.shard(ctx)).catch(() => undefined);
  }

  async destroy(ctx: NumberContext) {
    await this.disconnect(ctx);
    await this.api(`/instance/delete/${this.instance(ctx)}`, { method: 'DELETE' }, this.shard(ctx)).catch(() => undefined);
  }

  async getStatus(ctx: NumberContext) {
    const r = await this.api<any>(`/instance/connectionState/${this.instance(ctx)}`, undefined, this.shard(ctx)).catch(() => null);
    return this.mapConnection(r?.instance?.state);
  }

  async send(ctx: NumberContext, m: OutboundMessage, media?: MediaPayload): Promise<SendResult> {
    const name = this.instance(ctx);
    let r: any;
    if (m.type === MessageType.TEXT) {
      r = await this.api(`/message/sendText/${name}`, {
        method: 'POST',
        body: JSON.stringify({ number: m.to, text: m.text ?? '', quoted: m.quotedExternalId ? { key: { id: m.quotedExternalId } } : undefined }),
      }, this.shard(ctx));
    } else if (m.type === MessageType.AUDIO && media) {
      // áudio como "mensagem de voz" (PTT), igual ao gravado no app
      r = await this.api(`/message/sendWhatsAppAudio/${name}`, {
        method: 'POST',
        body: JSON.stringify({ number: m.to, audio: media.data.toString('base64') }),
      }, this.shard(ctx));
    } else if (media || m.media) {
      // a Evolution aceita `media` como URL ou base64 — mandamos base64 para não expor o storage
      r = await this.api(`/message/sendMedia/${name}`, {
        method: 'POST',
        body: JSON.stringify({
          number: m.to,
          mediatype: m.type,
          media: media ? media.data.toString('base64') : m.media?.url,
          mimetype: media?.mimeType ?? m.media?.mimeType,
          fileName: media?.fileName ?? m.media?.fileName,
          caption: m.media?.caption ?? m.text,
        }),
      }, this.shard(ctx));
    } else {
      throw new BadRequestException(`Tipo não suportado pela Evolution: ${m.type}`);
    }
    return { externalId: r?.key?.id ?? crypto.randomUUID(), status: MessageStatus.SENT, billingCategory: BillingCategory.UNOFFICIAL };
  }

  /** Evolution descriptografa e devolve a mídia em base64 a partir da key da mensagem. */
  async fetchMedia(ctx: NumberContext, msg: InboundMessage): Promise<MediaPayload | null> {
    if (!msg.media) return null;
    const raw = msg.raw as any;
    const r = await this.api<any>(`/chat/getBase64FromMediaMessage/${this.instance(ctx)}`, {
      method: 'POST',
      body: JSON.stringify({ message: { key: raw?.key }, convertToMp4: false }),
    }, this.shard(ctx));
    if (!r?.base64) return null;
    return { data: Buffer.from(r.base64, 'base64'), mimeType: r.mimetype ?? msg.media.mimeType ?? 'application/octet-stream', fileName: r.fileName ?? msg.media.fileName };
  }

  async markRead(ctx: NumberContext, externalMessageId: string) {
    await this.api(`/chat/markMessageAsRead/${this.instance(ctx)}`, {
      method: 'POST',
      body: JSON.stringify({ readMessages: [{ id: externalMessageId }] }),
    }, this.shard(ctx)).catch(() => undefined);
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer) {
    const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
    // 1) chamada manual/teste com a chave global no header
    if (eq(String(headers['apikey'] ?? ''), env.EVOLUTION_API_KEY)) return;
    // 2) webhook real: `apikey` no corpo é o token da instância que nós mesmos geramos
    let body: any = {};
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      /* corpo inválido cai no erro abaixo */
    }
    if (typeof body?.instance === 'string' && eq(String(body.apikey ?? ''), this.instanceToken(body.instance))) return;
    throw new UnauthorizedException('Webhook Evolution não autenticado');
  }

  parseWebhook(body: any): ParsedWebhook {
    const out: ParsedWebhook = { messages: [], statuses: [] };
    const externalNumberId: string = body?.instance;
    const data = body?.data;

    switch (body?.event) {
      case 'messages.upsert': {
        const items = Array.isArray(data) ? data : [data];
        for (const m of items) {
          if (!m?.key || m.key.fromMe) continue;
          if (m.key.remoteJid?.endsWith('@g.us')) continue; // grupos ficam fora do atendimento
          out.messages.push(this.toInbound(m, externalNumberId));
        }
        break;
      }
      case 'messages.update': {
        const items = Array.isArray(data) ? data : [data];
        for (const u of items) {
          const id = u?.keyId ?? u?.key?.id;
          if (!id) continue;
          out.statuses.push({ provider: 'evolution', externalId: id, status: this.mapAck(u.status), timestamp: new Date() });
        }
        break;
      }
      case 'connection.update': {
        const phone = typeof data?.wuid === 'string' ? data.wuid.replace(/@.*$/, '') : undefined;
        // statusReason 401 = deslogado pelo celular (device_removed / logged out)
        const loggedOut = data?.state === 'close' && Number(data?.statusReason) === 401;
        out.connection = { externalNumberId, status: this.mapConnection(data?.state), phone, transient: data?.state === 'connecting', loggedOut };
        break;
      }
      case 'qrcode.updated':
        out.connection = { externalNumberId, status: NumberStatus.PENDING_QR, qrCode: data?.qrcode?.base64 };
        break;
    }
    return out;
  }

  private toInbound(m: any, externalNumberId: string): InboundMessage {
    const msg = m.message ?? {};
    const from = String(m.key.remoteJid).replace(/@.*$/, '');
    let type: MessageType = MessageType.UNKNOWN;
    let text: string | undefined;
    let media: InboundMessage['media'];
    if (msg.conversation || msg.extendedTextMessage) {
      type = MessageType.TEXT;
      text = msg.conversation ?? msg.extendedTextMessage?.text;
    } else if (msg.imageMessage) {
      type = MessageType.IMAGE;
      media = { mimeType: msg.imageMessage.mimetype, caption: msg.imageMessage.caption };
    } else if (msg.audioMessage) {
      type = MessageType.AUDIO;
      media = { mimeType: msg.audioMessage.mimetype };
    } else if (msg.videoMessage) {
      type = MessageType.VIDEO;
      media = { mimeType: msg.videoMessage.mimetype, caption: msg.videoMessage.caption };
    } else if (msg.documentMessage) {
      type = MessageType.DOCUMENT;
      media = { mimeType: msg.documentMessage.mimetype, fileName: msg.documentMessage.fileName };
    } else if (msg.stickerMessage) {
      type = MessageType.STICKER;
    } else if (msg.locationMessage) {
      type = MessageType.LOCATION;
    }
    return {
      provider: 'evolution',
      externalId: m.key.id,
      externalNumberId,
      from,
      contactName: m.pushName,
      type,
      text: text ?? media?.caption,
      media: media ? { ...media, providerMediaId: m.key.id } : undefined,
      location: msg.locationMessage ? { lat: msg.locationMessage.degreesLatitude, lng: msg.locationMessage.degreesLongitude } : undefined,
      quotedExternalId: msg.extendedTextMessage?.contextInfo?.stanzaId,
      referral: this.referralOf(msg),
      timestamp: new Date(Number(m.messageTimestamp) * 1000),
      raw: m,
    };
  }

  /**
   * Via Baileys, um clique em anúncio chega com `contextInfo.externalAdReply`
   * (title, body, sourceUrl, sourceId, ctwaClid) ou `conversionSource`. Menos completo que a Meta,
   * mas suficiente para marcar a origem.
   */
  private referralOf(msg: any): InboundMessage['referral'] | undefined {
    const ctx = msg.extendedTextMessage?.contextInfo ?? msg.imageMessage?.contextInfo ?? msg.videoMessage?.contextInfo ?? msg.conversation?.contextInfo;
    const ad = ctx?.externalAdReply;
    if (ad) {
      const isAd = ad.sourceType === 'ad' || !!ad.ctwaClid || /facebook\.com\/ads|fb\.me\/ad|instagram\.com/i.test(ad.sourceUrl ?? '');
      return {
        sourceType: isAd ? 'ad' : ad.sourceUrl ? 'link' : 'unknown',
        sourceId: ad.sourceId,
        sourceUrl: ad.sourceUrl,
        headline: ad.title,
        body: ad.body,
        ctwaClid: ad.ctwaClid,
        mediaUrl: ad.thumbnailUrl ?? ad.mediaUrl,
      };
    }
    if (ctx?.conversionSource || ctx?.entryPointConversionSource) {
      const src = String(ctx.conversionSource ?? ctx.entryPointConversionSource);
      return { sourceType: /ad|ctwa/i.test(src) ? 'ad' : 'link', body: src, ctwaClid: ctx.ctwaClid };
    }
    return undefined;
  }

  private mapAck(s: string | number): MessageStatus {
    const v = String(s).toUpperCase();
    if (v === 'READ' || v === '4') return MessageStatus.READ;
    if (v === 'DELIVERY_ACK' || v === '3') return MessageStatus.DELIVERED;
    if (v === 'SERVER_ACK' || v === '2') return MessageStatus.SENT;
    if (v === 'ERROR') return MessageStatus.FAILED;
    return MessageStatus.PENDING;
  }

  private mapConnection(state?: string): NumberStatus {
    if (state === 'open') return NumberStatus.CONNECTED;
    if (state === 'connecting') return NumberStatus.PENDING_QR;
    return NumberStatus.DISCONNECTED;
  }
}
