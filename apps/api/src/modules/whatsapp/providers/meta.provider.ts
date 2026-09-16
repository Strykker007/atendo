import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MessageStatus, MessageType, NumberStatus, BillingCategory } from '@atendo/shared';
import type { InboundMessage, OutboundMessage, SendResult, StatusUpdate } from '@atendo/shared';
import { env } from '../../../config/env';
import type { NumberContext, ParsedWebhook, WhatsAppProvider } from './provider.interface';

/** providerConfig (criptografado) de um número Meta */
export interface MetaNumberConfig {
  accessToken: string; // token permanente do System User
  phoneNumberId: string;
  wabaId: string;
}

/**
 * WhatsApp Cloud API (oficial).
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */
@Injectable()
export class MetaProvider implements WhatsAppProvider {
  readonly kind = 'meta' as const;
  private readonly base = `https://graph.facebook.com/${env.META_GRAPH_VERSION}`;

  private cfg(ctx: NumberContext): MetaNumberConfig {
    return ctx.config as unknown as MetaNumberConfig;
  }

  private async graph<T>(cfg: MetaNumberConfig, path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json', ...init?.headers },
    });
    const json = (await res.json()) as any;
    if (!res.ok) throw new BadRequestException(json?.error?.message ?? `Meta API ${res.status}`);
    return json as T;
  }

  async connect(ctx: NumberContext) {
    // Na Meta não há "conectar": basta validar o token/phone_number_id.
    await this.graph(this.cfg(ctx), `${this.cfg(ctx).phoneNumberId}?fields=display_phone_number`);
    return { status: NumberStatus.CONNECTED };
  }

  async disconnect() {
    /* nada a fazer: o número continua na WABA */
  }

  async getStatus(ctx: NumberContext) {
    try {
      await this.connect(ctx);
      return NumberStatus.CONNECTED;
    } catch {
      return NumberStatus.ERROR;
    }
  }

  async send(ctx: NumberContext, m: OutboundMessage): Promise<SendResult> {
    const cfg = this.cfg(ctx);
    const body: Record<string, unknown> = { messaging_product: 'whatsapp', to: m.to };
    let billingCategory: BillingCategory = BillingCategory.SERVICE;

    if (m.template) {
      body.type = 'template';
      body.template = { name: m.template.name, language: { code: m.template.language }, components: m.template.components };
      billingCategory = m.template.category;
    } else if (m.type === MessageType.TEXT) {
      body.type = 'text';
      body.text = { body: m.text ?? '' };
    } else if (m.media) {
      body.type = m.type;
      body[m.type] = { link: m.media.url, caption: m.media.caption, filename: m.media.fileName };
    } else {
      throw new BadRequestException(`Tipo não suportado pela Meta: ${m.type}`);
    }
    if (m.quotedExternalId) body.context = { message_id: m.quotedExternalId };

    const res = await this.graph<{ messages: { id: string }[] }>(cfg, `${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { externalId: res.messages[0].id, status: MessageStatus.SENT, billingCategory };
  }

  async markRead(ctx: NumberContext, externalMessageId: string) {
    const cfg = this.cfg(ctx);
    await this.graph(cfg, `${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: externalMessageId }),
    });
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer) {
    if (!env.META_APP_SECRET) return; // dev sem app secret
    const sig = String(headers['x-hub-signature-256'] ?? '');
    const expected = 'sha256=' + createHmac('sha256', env.META_APP_SECRET).update(rawBody).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Assinatura Meta inválida');
  }

  parseWebhook(body: any): ParsedWebhook {
    const out: ParsedWebhook = { messages: [], statuses: [] };
    for (const entry of body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value;
        const externalNumberId: string = v?.metadata?.phone_number_id;
        const names = new Map<string, string>((v?.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]));
        for (const msg of v?.messages ?? []) out.messages.push(this.toInbound(msg, externalNumberId, names.get(msg.from)));
        for (const st of v?.statuses ?? []) {
          out.statuses.push({
            provider: 'meta',
            externalId: st.id,
            status: this.mapStatus(st.status),
            timestamp: new Date(Number(st.timestamp) * 1000),
            error: st.errors?.[0]?.title,
          });
        }
      }
    }
    return out;
  }

  private toInbound(msg: any, externalNumberId: string, contactName?: string): InboundMessage {
    const type = (Object.values(MessageType) as string[]).includes(msg.type) ? (msg.type as MessageType) : MessageType.UNKNOWN;
    const mediaObj = msg[msg.type];
    return {
      provider: 'meta',
      externalId: msg.id,
      externalNumberId,
      from: msg.from,
      contactName,
      type,
      text: msg.text?.body ?? mediaObj?.caption,
      media:
        mediaObj?.id !== undefined
          ? { providerMediaId: mediaObj.id, mimeType: mediaObj.mime_type, fileName: mediaObj.filename, caption: mediaObj.caption }
          : undefined,
      location: msg.location ? { lat: msg.location.latitude, lng: msg.location.longitude, name: msg.location.name } : undefined,
      quotedExternalId: msg.context?.id,
      timestamp: new Date(Number(msg.timestamp) * 1000),
      raw: msg,
    };
  }

  private mapStatus(s: string): MessageStatus {
    switch (s) {
      case 'sent':
        return MessageStatus.SENT;
      case 'delivered':
        return MessageStatus.DELIVERED;
      case 'read':
        return MessageStatus.READ;
      case 'failed':
        return MessageStatus.FAILED;
      default:
        return MessageStatus.PENDING;
    }
  }
}
