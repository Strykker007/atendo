import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { MessageStatus, MessageType, NumberStatus, BillingCategory, templateParams } from '@atendo/shared';
import type { InboundMessage, MessageTemplate, OutboundMessage, SendResult, StatusUpdate } from '@atendo/shared';
import { env } from '../../../config/env';
import type { MediaPayload, NumberContext, OutboundReaction, ParsedWebhook, WhatsAppProvider } from './provider.interface';
import { describeMetaError, ProviderSendError } from './provider-error';
import { textoQualquer } from './payload-text';

/** providerConfig (criptografado) de um número Meta */
export interface MetaNumberConfig {
  accessToken: string; // token permanente do System User
  phoneNumberId: string;
  wabaId: string;
  /** PIN da verificação em duas etapas definido no registro (cadastro incorporado) */
  pin?: string;
}

/** um ponto do `pricing_analytics` (granularidade diária) */
export interface MetaPricingPoint {
  start: number;
  end: number;
  phone_number?: string;
  pricing_category?: string;
  pricing_type?: string;
  volume?: number;
  cost?: number;
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
    if (!res.ok) throw new ProviderSendError(describeMetaError(json?.error, `Meta API ${res.status}`), res.status, typeof json?.error?.code === 'number' ? json.error.code : undefined);
    return json as T;
  }

  /**
   * Na Meta não há QR: conectar = validar token e phone_number_id e inscrever o app na WABA.
   * Sem a inscrição (`subscribed_apps`) a Meta não manda webhook nenhum do número — recebe nada,
   * mesmo com o webhook configurado no app. É idempotente: reconectar não duplica.
   */
  async connect(ctx: NumberContext) {
    const cfg = this.cfg(ctx);
    await this.graph(cfg, `${cfg.phoneNumberId}?fields=display_phone_number`);
    if (cfg.wabaId) await this.graph(cfg, `${cfg.wabaId}/subscribed_apps`, { method: 'POST' });
    return { status: NumberStatus.CONNECTED };
  }

  /**
   * Cadastro incorporado (docs/meta-cadastro-incorporado.md), depois que o cliente terminou a janela
   * da Meta: troca o código (vale 30 s) pelo token de negócio do cliente, lê o número e o registra
   * na Cloud API com um PIN novo. A inscrição do app na WABA fica no `connect`, como no manual.
   * Registro recusado (número com PIN de outro sistema) não impede o cadastro: volta em `registerError`.
   */
  async embeddedSignup(code: string, wabaId: string, phoneNumberId: string) {
    if (!env.META_APP_ID || !env.META_APP_SECRET) throw new BadRequestException('Cadastro pela Meta não está configurado neste servidor.');
    const q = new URLSearchParams({ client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, code });
    const res = await fetch(`${this.base}/oauth/access_token?${q}`);
    const tok = (await res.json()) as { access_token?: string; error?: { message?: string; code?: number } };
    if (!res.ok || !tok.access_token) throw new BadRequestException(describeMetaError(tok.error, 'A Meta não liberou o acesso. Abra a janela da Meta de novo.'));
    const cfg: MetaNumberConfig = { accessToken: tok.access_token, phoneNumberId, wabaId };
    const info = await this.graph<{ display_phone_number?: string; verified_name?: string }>(cfg, `${phoneNumberId}?fields=display_phone_number,verified_name`);
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    let registerError: string | undefined;
    await this.graph(cfg, `${phoneNumberId}/register`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', pin }) })
      .catch((err) => { registerError = err instanceof Error ? err.message : String(err); });
    return {
      config: { ...cfg, ...(!registerError && { pin }) },
      phone: (info.display_phone_number ?? '').replace(/\D/g, ''),
      verifiedName: info.verified_name ?? null,
      registerError,
    };
  }

  /**
   * Gasto real da WABA por dia, categoria, tipo e telefone (`pricing_analytics`, cobrança por
   * mensagem desde 07/2025). A Meta fecha o dia com algumas horas de atraso. `start`/`end` em
   * segundos (epoch). Docs: https://developers.facebook.com/docs/whatsapp/business-management-api/analytics
   */
  async pricingAnalytics(ctx: NumberContext, start: number, end: number) {
    const cfg = this.cfg(ctx);
    const field = `pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(["PRICING_CATEGORY","PRICING_TYPE","PHONE"])`;
    const r = await this.graph<{ currency?: string; pricing_analytics?: { data?: { data_points?: MetaPricingPoint[] }[] } }>(cfg, `${cfg.wabaId}?fields=currency,${encodeURIComponent(field)}`);
    return {
      currency: r.currency ?? 'USD',
      points: (r.pricing_analytics?.data ?? []).flatMap((d) => d.data_points ?? []),
    };
  }

  async disconnect() {
    /* nada a fazer: o número continua na WABA */
  }

  /** Só lê o número (o health check roda sempre; a inscrição fica no `connect`). */
  async getStatus(ctx: NumberContext) {
    try {
      const cfg = this.cfg(ctx);
      await this.graph(cfg, `${cfg.phoneNumberId}?fields=display_phone_number`);
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
      const components = [...(m.template.components ?? [])];
      const kind = m.template.headerMedia;
      if (kind) {
        // cabeçalho de mídia: arquivo do nosso storage sobe para a Meta (vai por id); link público vai como está
        const ref = media ? { id: await this.uploadMedia(cfg, media) } : m.media?.url?.startsWith('http') ? { link: m.media.url } : null;
        if (!ref) throw new BadRequestException('Template com cabeçalho de mídia sem o arquivo do cabeçalho.');
        const fileName = media?.fileName ?? m.media?.fileName;
        components.unshift({ type: 'header', parameters: [{ type: kind, [kind]: { ...ref, ...(kind === 'document' && fileName && { filename: fileName }) } }] });
      }
      body.template = { name: m.template.name, language: { code: m.template.language }, ...(components.length && { components }) };
      billingCategory = m.template.category;
    } else if (m.type === MessageType.TEXT) {
      body.type = 'text';
      body.text = { body: m.text ?? '' };
    } else if (media) {
      // sobe o binário para a Meta e envia pelo id — sem expor URL do nosso storage
      const mediaId = await this.uploadMedia(cfg, media);
      body.type = m.type;
      body[m.type] = { id: mediaId, ...metaMediaExtras(m.type, m.media?.caption ?? m.text, media.fileName) };
    } else if (m.media?.url) {
      body.type = m.type;
      body[m.type] = { link: m.media.url, ...metaMediaExtras(m.type, m.media.caption, m.media.fileName) };
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
    if (!res.ok) throw new ProviderSendError(describeMetaError(json?.error, 'Falha no upload de mídia para a Meta'), res.status, typeof json?.error?.code === 'number' ? json.error.code : undefined);
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

  /** Reação é um tipo de mensagem na Cloud API, mas sem id útil para nós: só marca a reagida. */
  async react(ctx: NumberContext, r: OutboundReaction) {
    const cfg = this.cfg(ctx);
    await this.graph(cfg, `${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: r.to, type: 'reaction', reaction: { message_id: r.targetExternalId, emoji: r.emoji } }),
    });
  }

  /** Templates APROVADOS da WABA. Pagina pelo cursor da Graph (teto de 10 páginas = 1.000 templates). */
  async listTemplates(ctx: NumberContext): Promise<MessageTemplate[]> {
    const cfg = this.cfg(ctx);
    if (!cfg.wabaId) throw new BadRequestException('Número sem WABA ID configurado: não dá para listar os templates.');
    const out: MessageTemplate[] = [];
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({ fields: 'id,name,language,category,status,components', status: 'APPROVED', limit: '100', ...(after && { after }) });
      const res = await this.graph<{ data: any[]; paging?: { cursors?: { after?: string }; next?: string } }>(cfg, `${cfg.wabaId}/message_templates?${qs}`);
      for (const raw of res.data ?? []) {
        const t = parseMetaTemplate(raw);
        if (t) out.push(t);
      }
      after = res.paging?.next ? res.paging.cursors?.after : undefined;
      if (!after) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));
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
    const out: ParsedWebhook = { messages: [], statuses: [], reactions: [] };
    for (const entry of body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value;
        const externalNumberId: string = v?.metadata?.phone_number_id;
        const names = new Map<string, string>((v?.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]));
        for (const msg of v?.messages ?? []) {
          // reação não é mensagem: `emoji` ausente = o contato retirou a reação
          if (msg.type === 'reaction') {
            if (msg.reaction?.message_id) {
              out.reactions.push({
                provider: 'meta',
                externalNumberId,
                targetExternalId: msg.reaction.message_id,
                from: msg.from,
                fromMe: false,
                emoji: msg.reaction.emoji ?? '',
                timestamp: new Date(Number(msg.timestamp) * 1000),
              });
            }
            continue;
          }
          out.messages.push(this.toInbound(msg, externalNumberId, names.get(msg.from)));
        }
        for (const st of v?.statuses ?? []) {
          out.statuses.push({
            provider: 'meta',
            externalNumberId,
            externalId: st.id,
            status: this.mapStatus(st.status),
            timestamp: new Date(Number(st.timestamp) * 1000),
            error: st.errors?.[0] ? describeMetaError(st.errors[0], 'Falha na entrega') : undefined,
          });
        }
      }
    }
    return out;
  }

  private toInbound(msg: any, externalNumberId: string, contactName?: string): InboundMessage {
    const lido = this.lerTipo(msg);
    // encaminhada: a Cloud API não dá o score, só se foi encaminhada "com frequência" (≥ 5)
    const ctx = msg.context ?? {};
    const forwarded = !!(ctx.forwarded || ctx.frequently_forwarded);
    return {
      provider: 'meta',
      externalId: msg.id,
      externalNumberId,
      from: msg.from,
      contactName,
      ...lido,
      forwarded: forwarded || undefined,
      forwardingScore: ctx.frequently_forwarded ? 5 : undefined,
      // mensagem encaminhada também traz `context`, mas sem `id`: não é citação
      quotedExternalId: ctx.id,
      referral: this.referralOf(msg),
      timestamp: new Date(Number(msg.timestamp) * 1000),
      raw: msg,
    };
  }

  /** Tipo do webhook da Cloud API → tipo canônico. O que não for mapeado tenta o fallback de texto. */
  private lerTipo(msg: any): Pick<InboundMessage, 'type' | 'text' | 'media' | 'content' | 'interactiveReplyId'> {
    switch (msg.type) {
      case 'text':
        return { type: MessageType.TEXT, text: msg.text?.body };
      case 'image':
      case 'video':
      case 'audio':
      case 'document':
      case 'sticker': {
        const o = msg[msg.type] ?? {};
        return {
          type: msg.type as MessageType,
          text: o.caption || undefined,
          media: o.id !== undefined ? { providerMediaId: o.id, mimeType: o.mime_type, fileName: o.filename, caption: o.caption } : undefined,
        };
      }
      case 'location': {
        const l = msg.location ?? {};
        return { type: MessageType.LOCATION, content: { kind: 'location', lat: Number(l.latitude), lng: Number(l.longitude), name: l.name || undefined, address: l.address || undefined } };
      }
      case 'contacts':
        return {
          type: MessageType.CONTACT,
          content: {
            kind: 'contacts',
            contacts: (msg.contacts ?? []).map((c: any) => ({
              name: c.name?.formatted_name ?? c.name?.first_name ?? 'Contato',
              phones: (c.phones ?? []).map((p: any) => p.wa_id ?? p.phone).filter(Boolean),
            })),
          },
        };
      case 'interactive': {
        // resposta a botão/lista/flow: chega com o id e o título escolhidos
        const i = msg.interactive ?? {};
        const reply = i.button_reply ?? i.list_reply;
        if (reply) return { type: MessageType.TEXT, text: reply.title, interactiveReplyId: reply.id };
        if (i.nfm_reply) return { type: MessageType.TEXT, text: i.nfm_reply.body ?? i.nfm_reply.name ?? 'Formulário respondido' };
        break;
      }
      case 'button':
        // toque em botão de resposta rápida de um template
        return { type: MessageType.TEXT, text: msg.button?.text, interactiveReplyId: msg.button?.payload };
      case 'order':
        return { type: MessageType.TEXT, text: `🛒 Pedido (${msg.order?.product_items?.length ?? 0} itens)${msg.order?.text ? `\n${msg.order.text}` : ''}` };
      case 'system':
        return { type: MessageType.TEXT, text: msg.system?.body };
    }
    // `unsupported`, tipos novos: qualquer texto que houver, em vez de "unknown"
    const text = textoQualquer(msg);
    return text ? { type: MessageType.TEXT, text } : { type: MessageType.UNKNOWN };
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

/**
 * Campos aceitos por tipo na Cloud API: legenda só em imagem, vídeo e documento; nome do
 * arquivo só em documento. Áudio e figurinha recusam o envio se vierem com `caption`.
 * A Meta não tem "áudio como arquivo": o áudio sempre chega como player — e só OGG/Opus
 * aparece como mensagem de voz.
 */
function metaMediaExtras(type: string, caption?: string, filename?: string) {
  const out: { caption?: string; filename?: string } = {};
  if ((type === MessageType.IMAGE || type === MessageType.VIDEO || type === MessageType.DOCUMENT) && caption) out.caption = caption;
  if (type === MessageType.DOCUMENT && filename) out.filename = filename;
  return out;
}

/**
 * Template da Graph API → formato canônico. `null` = não é aprovado (a listagem já filtra, mas
 * status muda). O que o painel ainda não sabe preencher (cabeçalho de localização, botão de
 * formulário/catálogo, código de autenticação) volta com `unsupported` em vez de sumir: o
 * atendente vê que o template existe e por que não dá para usar daqui.
 */
export function parseMetaTemplate(raw: any): MessageTemplate | null {
  if (!raw?.name || String(raw.status ?? 'APPROVED').toUpperCase() !== 'APPROVED') return null;
  const comps: any[] = Array.isArray(raw.components) ? raw.components : [];
  const find = (type: string) => comps.find((c) => String(c?.type).toUpperCase() === type);
  const header = find('HEADER');
  const body = find('BODY');
  const footer = find('FOOTER');
  const buttons: any[] = find('BUTTONS')?.buttons ?? [];
  const headerFormat = header?.format ? (String(header.format).toUpperCase() as MessageTemplate['headerFormat']) : undefined;
  const category = String(raw.category ?? '').toLowerCase();

  let unsupported: string | undefined;
  if (category === 'authentication') unsupported = 'Template de autenticação (código) não é enviado pelo painel.';
  else if (headerFormat === 'LOCATION') unsupported = 'Cabeçalho com localização ainda não é suportado no painel.';
  else if (buttons.some((b) => ['FLOW', 'CATALOG', 'MPM', 'OTP'].includes(String(b?.type).toUpperCase()))) unsupported = 'Botão de formulário/catálogo ainda não é suportado no painel.';

  // botões que pedem valor no envio: link com {{1}} no fim e "Copiar código" (cupom)
  const dynamicButtons = buttons.flatMap((b, index): NonNullable<MessageTemplate['dynamicButtons']> => {
    const type = String(b?.type).toUpperCase();
    if (type === 'URL' && templateParams(b?.url).length) return [{ index, kind: 'url' as const, text: String(b?.text ?? ''), url: String(b.url) }];
    if (type === 'COPY_CODE') return [{ index, kind: 'copy_code' as const, text: String(b?.text ?? 'Copiar código') }];
    return [];
  });

  return {
    id: String(raw.id ?? `${raw.name}:${raw.language}`),
    name: raw.name,
    language: raw.language ?? 'pt_BR',
    category: category === 'marketing' || category === 'authentication' ? category : 'utility',
    header: headerFormat === 'TEXT' ? header?.text : undefined,
    headerFormat,
    body: body?.text ?? '',
    footer: footer?.text,
    buttons: buttons.map((b) => String(b?.text ?? '')).filter(Boolean),
    headerParams: headerFormat === 'TEXT' ? templateParams(header?.text) : [],
    bodyParams: templateParams(body?.text),
    ...(dynamicButtons.length && { dynamicButtons }),
    ...(unsupported && { unsupported }),
  };
}
