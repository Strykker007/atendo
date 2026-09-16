import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { BillingCategory, MessageStatus, MessageType, NumberStatus } from '@atendo/shared';
import type { InboundMessage, OutboundMessage, SendResult, StatusUpdate } from '@atendo/shared';
import { env } from '../../../config/env';
import type { NumberContext, ParsedWebhook, WhatsAppProvider } from './provider.interface';

/** providerConfig de um número Evolution */
export interface EvolutionNumberConfig {
  instanceName: string;
  /** token da instância (Evolution gera um por instância) */
  instanceToken?: string;
}

/**
 * Evolution API (não-oficial, via QR code). Custo por mensagem = 0.
 * Docs: https://doc.evolution-api.com
 */
@Injectable()
export class EvolutionProvider implements WhatsAppProvider {
  readonly kind = 'evolution' as const;

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${env.EVOLUTION_BASE_URL}${path}`, {
      ...init,
      headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json', ...init?.headers },
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new BadRequestException(json?.response?.message ?? json?.message ?? `Evolution ${res.status}`);
    return json as T;
  }

  private instance(ctx: NumberContext) {
    return (ctx.config as unknown as EvolutionNumberConfig).instanceName ?? ctx.externalId;
  }

  async connect(ctx: NumberContext) {
    const name = this.instance(ctx);
    // cria se não existir; se já existe a Evolution devolve erro e seguimos para o QR
    await this.api('/instance/create', {
      method: 'POST',
      body: JSON.stringify({ instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true, number: ctx.phone }),
    }).catch(() => undefined);
    const r = await this.api<any>(`/instance/connect/${name}`);
    if (r?.instance?.state === 'open') return { status: NumberStatus.CONNECTED };
    return { status: NumberStatus.PENDING_QR, qrCode: r?.base64 ?? r?.code };
  }

  async disconnect(ctx: NumberContext) {
    await this.api(`/instance/logout/${this.instance(ctx)}`, { method: 'DELETE' }).catch(() => undefined);
  }

  async getStatus(ctx: NumberContext) {
    const r = await this.api<any>(`/instance/connectionState/${this.instance(ctx)}`).catch(() => null);
    return this.mapConnection(r?.instance?.state);
  }

  async send(ctx: NumberContext, m: OutboundMessage): Promise<SendResult> {
    const name = this.instance(ctx);
    let r: any;
    if (m.type === MessageType.TEXT) {
      r = await this.api(`/message/sendText/${name}`, {
        method: 'POST',
        body: JSON.stringify({ number: m.to, text: m.text ?? '', quoted: m.quotedExternalId ? { key: { id: m.quotedExternalId } } : undefined }),
      });
    } else if (m.media) {
      r = await this.api(`/message/sendMedia/${name}`, {
        method: 'POST',
        body: JSON.stringify({
          number: m.to,
          mediatype: m.type,
          media: m.media.url,
          mimetype: m.media.mimeType,
          fileName: m.media.fileName,
          caption: m.media.caption,
        }),
      });
    } else {
      throw new BadRequestException(`Tipo não suportado pela Evolution: ${m.type}`);
    }
    return { externalId: r?.key?.id ?? crypto.randomUUID(), status: MessageStatus.SENT, billingCategory: BillingCategory.UNOFFICIAL };
  }

  async markRead(ctx: NumberContext, externalMessageId: string) {
    await this.api(`/chat/markMessageAsRead/${this.instance(ctx)}`, {
      method: 'POST',
      body: JSON.stringify({ readMessages: [{ id: externalMessageId }] }),
    }).catch(() => undefined);
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>) {
    // A Evolution manda a API key no header `apikey` quando configurado; validamos igualdade constante.
    const got = Buffer.from(String(headers['apikey'] ?? ''));
    const want = Buffer.from(env.EVOLUTION_API_KEY);
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new UnauthorizedException('apikey Evolution inválida');
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
      case 'connection.update':
        out.connection = { externalNumberId, status: this.mapConnection(data?.state) };
        break;
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
      timestamp: new Date(Number(m.messageTimestamp) * 1000),
      raw: m,
    };
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
