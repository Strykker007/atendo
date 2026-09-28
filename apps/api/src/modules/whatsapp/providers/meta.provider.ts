import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MessageStatus, MessageType, NumberStatus, BillingCategory } from '@atendo/shared';
import type { InboundMessage, OutboundMessage, SendResult, StatusUpdate } from '@atendo/shared';
import { env } from '../../../config/env';
import type { MediaPayload, NumberContext, ParsedWebhook, WhatsAppProvider } from './provider.interface';
import { describeProviderError } from './provider-error';

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
    if (!res.ok) throw new BadRequestException(describeProviderError(json?.error, `Meta API ${res.status}`));
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

  async send(ctx: NumberContext, m: OutboundMessage, media?: MediaPayload): Promise<SendResult> {
    const cfg = this.cfg(ctx);
    const body: Record<string, unknown> = { messaging_product: 'whatsapp', to: m.to };
    let billingCategory: BillingCategory = BillingCategory.SERVICE;

    if (m.interactive && m.interactive.options.length) {
      const opts = m.interactive.options.slice(0, 10);
      body.type = 'interactive';
      const text = { text: (m.text ?? '').slice(0, 1024) };
      if (opts.length <= 3) {
        body.interactive = {
          type: 'button',
          ...(m.interactive.header && { header: { type: 'text', text: m.interactive.header.slice(0, 60) } }),
          body: text,
          ...(m.interactive.footer && { footer: { text: m.interactive.footer.slice(0, 60) } }),
          action: { buttons: opts.map((o) => ({ type: 'reply', reply: { id: o.id.slice(0, 256), title: o.title.slice(0, 20) } })) },
        };
      } else {
        body.interactive = {
          type: 'list',
          ...(m.interactive.header && { header: { type: 'text', text: m.interactive.header.slice(0, 60) } }),
          body: text,
          ...(m.interactive.footer && { footer: { text: m.interactive.footer.slice(0, 60) } }),
          action: { button: (m.interactive.listButton ?? 'Ver opções').slice(0, 20), sections: [{ title: 'Opções', rows: opts.map((o) => ({ id: o.id.slice(0, 200), title: o.title.slice(0, 24), ...(o.description && { description: o.description.slice(0, 72) }) })) }] },
        };
      }
    } else if (m.template) {
      body.type = 'template';
      body.template = { name: m.template.name, language: { code: m.template.language }, components: m.template.components };
      billingCategory = m.template.category;
    } else if (m.type === MessageType.TEXT) {
      body.type = 'text';
      body.text = { body: m.text ?? '' };
    } else if (media) {
      // sobe o binário para a Meta e envia pelo id — sem expor URL do nosso storage
      const mediaId = await this.uploadMedia(cfg, media);
      body.type = m.type;
      body[m.type] = { id: mediaId, caption: m.media?.caption ?? m.text, filename: media.fileName };
    } else if (m.media?.url) {
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

  private async uploadMedia(cfg: MetaNumberConfig, media: MediaPayload): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', media.mimeType);
    form.append('file', new Blob([new Uint8Array(media.data)], { type: media.mimeType }), media.fileName ?? 'file');
    const res = await fetch(`${this.base}/${cfg.phoneNumberId}/media`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.accessToken}` }, body: form });
    const json = (await res.json()) as any;
    if (!res.ok) throw new BadRequestException(describeProviderError(json?.error, 'Falha no upload de mídia para a Meta'));
    return json.id as string;
  }

  /** Meta: GET /{media-id} devolve uma URL temporária; baixamos com o mesmo token. */
  async fetchMedia(ctx: NumberContext, msg: InboundMessage): Promise<MediaPayload | null> {
    const id = msg.media?.providerMediaId;
    if (!id) return null;
    const cfg = this.cfg(ctx);
    const meta = await this.graph<{ url: string; mime_type: string }>(cfg, id);
    const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${cfg.accessToken}` } });
    if (!res.ok) throw new BadRequestException(`Download de mídia Meta falhou (${res.status})`);
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: meta.mime_type ?? msg.media?.mimeType ?? 'application/octet-stream', fileName: msg.media?.fileName };
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
    // resposta a botão/lista: chega como type 'interactive' com o id e o título escolhidos
    const reply = msg.type === 'interactive' ? (msg.interactive?.button_reply ?? msg.interactive?.list_reply) : undefined;
    const type = reply ? MessageType.TEXT : (Object.values(MessageType) as string[]).includes(msg.type) ? (msg.type as MessageType) : MessageType.UNKNOWN;
    const mediaObj = msg[msg.type];
    return {
      provider: 'meta',
      externalId: msg.id,
      externalNumberId,
      from: msg.from,
      contactName,
      type,
      text: reply?.title ?? msg.text?.body ?? mediaObj?.caption,
      interactiveReplyId: reply?.id,
      media:
        mediaObj?.id !== undefined
          ? { providerMediaId: mediaObj.id, mimeType: mediaObj.mime_type, fileName: mediaObj.filename, caption: mediaObj.caption }
          : undefined,
      location: msg.location ? { lat: msg.location.latitude, lng: msg.location.longitude, name: msg.location.name } : undefined,
      quotedExternalId: msg.context?.id,
      referral: this.referralOf(msg),
      timestamp: new Date(Number(msg.timestamp) * 1000),
      raw: msg,
    };
  }

  /**
   * Anúncio Click-to-WhatsApp: a primeira mensagem do contato vem com `referral`
   * (source_type 'ad' | 'post', source_id, headline, ctwa_clid). Só vem na primeira mensagem.
   */
  private referralOf(msg: any): InboundMessage['referral'] | undefined {
    const r = msg.referral;
    if (!r) return undefined;
    return {
      sourceType: r.source_type === 'ad' || r.source_type === 'post' ? r.source_type : 'unknown',
      sourceId: r.source_id,
      sourceUrl: r.source_url,
      headline: r.headline,
      body: r.body,
      ctwaClid: r.ctwa_clid,
      mediaUrl: r.image_url ?? r.video_url ?? r.thumbnail_url,
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
