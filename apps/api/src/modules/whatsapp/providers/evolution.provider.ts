import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { BillingCategory, MessageStatus, MessageType, NumberStatus } from '@atendo/shared';
import type { InboundMessage, OutboundMessage, SendResult, StatusUpdate } from '@atendo/shared';
import { env } from '../../../config/env';
import { bytesEmBase64, contextoDaCitacao, lerCitacao } from './quoted';
import { desembrulhar, eventoCifrado, lerConteudo, lerEdicao } from './evolution-content';
import type { HistoryPage, HistoryQuery, MediaPayload, NumberContext, OutboundEdit, OutboundReaction, OutboundRevoke, ParsedWebhook, RecentPage, RecentQuery, WhatsAppProvider } from './provider.interface';
import { phoneVariants } from '../../conversations/phone-variants';
import { isDefinitiveClose } from '../connection-events';
import { describeProviderError, ProviderSendError, ProviderTimeoutError } from './provider-error';

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
 * Evolution API (via QR code). Custo por mensagem = 0.
 * Docs: https://doc.evolution-api.com
 */
@Injectable()
export class EvolutionProvider implements WhatsAppProvider {
  readonly kind = 'evolution' as const;
  private readonly logger = new Logger('EvolutionProvider');

  /**
   * `delayMs`: tempo que a Evolution SEGURA a requisição antes de responder ("digitando…" do
   * `delay`) — soma-se ao prazo, senão todo envio humanizado estouraria.
   */
  private async api<T>(path: string, init?: RequestInit, shard?: { baseUrl?: string; apiKey?: string }, delayMs = 0): Promise<T> {
    const timeoutMs = evolutionTimeoutMs(path, delayMs);
    let res: Response;
    try {
      res = await fetch(`${shard?.baseUrl ?? env.EVOLUTION_BASE_URL}${path}`, {
        ...init,
        headers: { apikey: shard?.apiKey ?? env.EVOLUTION_API_KEY, 'Content-Type': 'application/json', ...init?.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw evolutionFetchError(err, path, timeoutMs);
    }
    // o prazo vale também para ler o corpo (o signal continua ativo)
    const json = (await res.json().catch((err) => {
      if (isAbort(err)) throw evolutionFetchError(err, path, timeoutMs);
      return {};
    })) as any;
    if (!res.ok) {
      throw new ProviderSendError(describeProviderError(json?.response?.message ?? json?.message ?? json, `Evolution ${res.status}`), res.status);
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
   * Não faz logout — as chaves continuam as mesmas: não conserta chave de recebimento
   * corrompida (receive-stall.ts); para essa, só ler o QR de novo.
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

  /**
   * Sonda da sessão (session-probe.ts): foto de perfil do próprio número — consulta IQ comum do
   * WhatsApp Web, sem cache no Baileys. Socket vivo responde em ~1 s (com ou sem foto); zumbi
   * travado não responde e estoura o prazo de 15 s.
   */
  async probe(ctx: NumberContext) {
    await this.api(`/chat/fetchProfilePictureUrl/${this.instance(ctx)}`, {
      method: 'POST',
      body: JSON.stringify({ number: ctx.phone }),
    }, this.shard(ctx));
  }

  async send(ctx: NumberContext, m: OutboundMessage, media?: MediaPayload): Promise<SendResult> {
    const name = this.instance(ctx);
    let r: any;
    // citação vai em todo tipo de envio (texto, mídia e voz): a Evolution acha a citada pelo id
    const quoted = m.quotedExternalId ? { key: { id: m.quotedExternalId } } : undefined;
    // `delay`: a Evolution mostra "digitando…" (no áudio, "gravando…") por esse tempo e só então entrega
    const delay = m.typingMs && m.typingMs > 0 ? Math.round(m.typingMs) : undefined;
    // cartão nativo do Pix ("Copiar chave Pix"), só com EVOLUTION_PIX_BUTTON: em conta QR o
    // WhatsApp aceita e confirma a entrega, mas o aparelho não mostra — e não há erro para cair
    // no texto. Desligado (padrão), vai o texto, que já traz título, tipo e chave. Evolution sem
    // o botão `pix` recusa com 400/404 e também cai no texto — nada saiu ainda
    const cartaoPix = m.pix && env.EVOLUTION_PIX_BUTTON ? await this.api<any>(`/message/sendButtons/${name}`, {
      method: 'POST',
      body: JSON.stringify({
        number: m.to,
        title: m.text?.split('\n')[0].replace(/\*/g, '') || 'Pix',
        description: `Chave Pix: ${m.pix.key}`,
        footer: m.pix.holderName,
        buttons: [{ type: 'pix', currency: 'BRL', name: m.pix.holderName, keyType: m.pix.keyType, key: m.pix.key }],
        quoted,
        delay,
      }),
    }, this.shard(ctx), delay).catch((err) => {
      if (err instanceof ProviderSendError && (err.providerStatus === 400 || err.providerStatus === 404)) return null;
      throw err;
    }) : null;
    // menu com até 3 opções como botões de resposta rápida (nativeFlow quick_reply), só com
    // EVOLUTION_MENU_BUTTONS — mesmo motivo do Pix: sem o <biz> o aparelho não mostra. Versão que
    // recusa (400/404) cai na lista numerada; a resposta volta como interactiveResponseMessage
    const opcoes = m.interactive?.options ?? [];
    const botoes = !cartaoPix && env.EVOLUTION_MENU_BUTTONS && opcoes.length > 0 && opcoes.length <= 3 ? await this.api<any>(`/message/sendButtons/${name}`, {
      method: 'POST',
      body: JSON.stringify({ number: m.to, ...menuButtonsPayload(m), quoted, delay }),
    }, this.shard(ctx), delay).catch((err) => {
      if (err instanceof ProviderSendError && (err.providerStatus === 400 || err.providerStatus === 404)) return null;
      throw err;
    }) : null;
    if (cartaoPix) {
      r = cartaoPix;
    } else if (botoes) {
      r = botoes;
    } else if (m.type === MessageType.TEXT || m.interactive) {
      // Botões/listas não funcionam de forma confiável em contas QR: vira lista numerada
      const text = m.interactive?.options.length ? `${m.text ?? ''}\n\n${m.interactive.options.map((o, i) => `${i + 1} - ${o.title}`).join('\n')}` : (m.text ?? '');
      r = await this.api(`/message/sendText/${name}`, {
        method: 'POST',
        body: JSON.stringify({ number: m.to, text, quoted, delay }),
      }, this.shard(ctx), delay);
    } else if (m.type === MessageType.AUDIO && media && m.media?.voice !== false) {
      // áudio como "mensagem de voz" (PTT), igual ao gravado no app
      r = await this.api(`/message/sendWhatsAppAudio/${name}`, {
        method: 'POST',
        body: JSON.stringify({ number: m.to, audio: media.data.toString('base64'), quoted, delay }),
      }, this.shard(ctx), delay);
    } else if (media || m.media) {
      // a Evolution aceita `media` como URL ou base64 — mandamos base64 para não expor o storage
      r = await this.api(`/message/sendMedia/${name}`, {
        method: 'POST',
        body: JSON.stringify({
          number: m.to,
          // áudio "como arquivo" vai como documento: o sendMedia não tem áudio comum
          mediatype: m.type === MessageType.AUDIO ? 'document' : m.type,
          media: media ? media.data.toString('base64') : m.media?.url,
          mimetype: media?.mimeType ?? m.media?.mimeType,
          fileName: media?.fileName ?? m.media?.fileName,
          caption: m.type === MessageType.AUDIO ? undefined : (m.media?.caption ?? m.text),
          quoted,
          delay,
        }),
      }, this.shard(ctx), delay);
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

  /**
   * Foto/vídeo do status que o contato respondeu. O status não é mensagem nossa, então não há
   * key para a Evolution buscar: mandamos o próprio `quotedMessage` (traz url + mediaKey) e ela
   * descriptografa. Passadas as 24h o WhatsApp apaga o arquivo e isto falha — quem chama cai
   * na miniatura.
   */
  async fetchQuotedMedia(ctx: NumberContext, msg: InboundMessage): Promise<MediaPayload | null> {
    if (!msg.quotedFromStatus || !msg.quotedMedia) return null;
    const raw = msg.raw as any;
    const ctxInfo = contextoDaCitacao(raw?.message, raw?.contextInfo);
    if (!ctxInfo?.quotedMessage) return null;
    const r = await this.api<any>(`/chat/getBase64FromMediaMessage/${this.instance(ctx)}`, {
      method: 'POST',
      body: JSON.stringify({
        message: { key: { id: ctxInfo.stanzaId, remoteJid: 'status@broadcast', participant: ctxInfo.participant, fromMe: false }, message: bytesEmBase64(ctxInfo.quotedMessage) },
        convertToMp4: false,
      }),
    }, this.shard(ctx));
    if (!r?.base64) return null;
    return { data: Buffer.from(r.base64, 'base64'), mimeType: r.mimetype ?? msg.quotedMedia.mimeType ?? (msg.quotedMedia.kind === 'video' ? 'video/mp4' : 'image/jpeg') };
  }

  /**
   * Foto de perfil do contato. A Evolution devolve uma URL da CDN do WhatsApp, que expira —
   * então baixamos o arquivo aqui e quem chama guarda no nosso storage. Mandar a URL da CDN
   * para o navegador também faria o painel do cliente buscar imagem direto do WhatsApp.
   */
  async fetchProfilePicture(ctx: NumberContext, phone: string): Promise<MediaPayload | null> {
    const r = await this.api<{ profilePictureUrl?: string }>(`/chat/fetchProfilePictureUrl/${this.instance(ctx)}`, {
      method: 'POST',
      body: JSON.stringify({ number: phone }),
    }, this.shard(ctx)).catch(() => null);
    if (!r?.profilePictureUrl) return null;

    const res = await fetch(r.profilePictureUrl, { signal: AbortSignal.timeout(EVOLUTION_MEDIA_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    return { data, mimeType: res.headers.get('content-type') ?? 'image/jpeg', fileName: `${phone}.jpg` };
  }

  /**
   * v2 pede a key inteira (`remoteJid` + `fromMe` + `id`). O jid vem de como a Evolution gravou a
   * mensagem (pode ser `@lid`); `phone` é o plano B quando não acha o registro.
   */
  async markRead(ctx: NumberContext, externalMessageId: string, phone?: string) {
    const remoteJid = await this.storedRemoteJid(ctx, externalMessageId, phone ?? '');
    if (!remoteJid.includes('@') || remoteJid.startsWith('@')) return;
    await this.api(`/chat/markMessageAsRead/${this.instance(ctx)}`, {
      method: 'POST',
      body: JSON.stringify({ readMessages: [{ remoteJid, fromMe: false, id: externalMessageId }] }),
    }, this.shard(ctx)).catch(() => undefined);
  }

  /** `POST /chat/whatsappNumbers`: `[{ exists, jid, number }]`. Erro/resposta estranha = não sabe. */
  async hasWhatsApp(ctx: NumberContext, phone: string): Promise<boolean | null> {
    try {
      const r = await this.api<any>(`/chat/whatsappNumbers/${this.instance(ctx)}`, {
        method: 'POST',
        body: JSON.stringify({ numbers: [phone.replace(/\D/g, '')] }),
      }, this.shard(ctx));
      const row = Array.isArray(r) ? r[0] : null;
      return typeof row?.exists === 'boolean' ? row.exists : null;
    } catch {
      return null;
    }
  }

  /** A Evolution localiza a reagida pela key inteira: chat + id + se fomos nós que mandamos. */
  async react(ctx: NumberContext, r: OutboundReaction) {
    await this.api(`/message/sendReaction/${this.instance(ctx)}`, {
      method: 'POST',
      body: JSON.stringify({
        key: { remoteJid: r.to.endsWith('@g.us') ? r.to : `${r.to.replace(/\D/g, '')}@s.whatsapp.net`, fromMe: r.targetFromMe, id: r.targetExternalId },
        reaction: r.emoji,
      }),
    }, this.shard(ctx));
  }

  /** Apagar para todos: a Evolution acha a mensagem pela key (chat + id + fromMe). */
  async revoke(ctx: NumberContext, t: OutboundRevoke) {
    const remoteJid = await this.storedRemoteJid(ctx, t.externalId, t.to);
    await this.api(`/chat/deleteMessageForEveryone/${this.instance(ctx)}`, {
      method: 'DELETE',
      body: JSON.stringify({ id: t.externalId, remoteJid, fromMe: true }),
    }, this.shard(ctx));
  }

  /**
   * Endereço da conversa como a Evolution GRAVOU a mensagem — é com ele que ela confere a edição
   * ("RemoteJid does not match") e manda o protocolo ao WhatsApp.
   *
   * Não dá para montar a partir do telefone: o WhatsApp está migrando contatos para o LID
   * (`242511201210535@lid`), e a mensagem digitada no celular costuma ficar gravada assim, enquanto
   * a enviada pela API fica como `<telefone>@s.whatsapp.net`. Além disso, para celular BR a
   * Evolution tira ou põe o nono dígito ao montar o JID. Sem registro, cai no telefone.
   */
  private async storedRemoteJid(ctx: NumberContext, externalId: string, phone: string): Promise<string> {
    // grupo nas conversas: o "telefone" já é o jid do grupo
    const fallback = phone.endsWith('@g.us') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
    try {
      const res = await this.api<any>(`/chat/findMessages/${this.instance(ctx)}`, {
        method: 'POST',
        body: JSON.stringify({ where: { key: { id: externalId } }, limit: 1 }),
      }, this.shard(ctx));
      // v2 devolve `{ messages: { records } }`; versões antigas, a lista direto
      const rows: any[] = Array.isArray(res) ? res : res?.messages?.records ?? [];
      const jid = rows.find((r) => r?.key?.id === externalId)?.key?.remoteJid;
      return typeof jid === 'string' && jid.includes('@') ? jid : fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Histórico do chat no banco da própria Evolution (`/chat/findMessages`), que guarda tudo o
   * que passou pelo aparelho desde o pareamento — inclusive o lote de histórico que o WhatsApp
   * manda ao ler o QR. O mesmo chat pode estar gravado como `<telefone>@s.whatsapp.net` (com ou
   * sem o nono dígito) ou como `@lid`; o `@lid` sai das mensagens que já temos (`storedRemoteJid`).
   */
  async fetchHistory(ctx: NumberContext, q: HistoryQuery): Promise<HistoryPage> {
    const jids = new Set(q.chatIds ?? phoneVariants(q.phone).map((p) => `${p}@s.whatsapp.net`));
    if (!q.chatIds) for (const id of q.knownExternalIds.slice(0, 2)) jids.add(await this.storedRemoteJid(ctx, id, q.phone));

    const lido = new Map<string, any>();
    let exhausted = true;
    for (const jid of jids) {
      const res = await this.api<any>(`/chat/findMessages/${this.instance(ctx)}`, {
        method: 'POST',
        // remoteJidAlt: versões novas acham também o chat gravado como @lid pelo telefone alternativo.
        // O filtro de horário só vale com gte E lte.
        body: JSON.stringify({ where: { key: { remoteJid: jid, remoteJidAlt: jid }, messageTimestamp: { gte: new Date(0).toISOString(), lte: q.before.toISOString() } }, offset: q.limit, page: 1 }),
      }, this.shard(ctx));
      const rows: any[] = Array.isArray(res) ? res : res?.messages?.records ?? [];
      if (rows.length >= q.limit) exhausted = false;
      for (const r of rows) if (r?.key?.id) lido.set(r.key.id, r);
    }

    const ordenadas = [...lido.values()].sort((a, b) => Number(b.messageTimestamp) - Number(a.messageTimestamp)).slice(0, q.limit);
    const oldestTs = ordenadas.length ? Number(ordenadas[ordenadas.length - 1].messageTimestamp) : NaN;
    const messages = ordenadas
      .filter((m) => ehMensagemDeConversa(m))
      .map((m) => ({ ...this.toInbound(m, ctx.externalId), fromMe: !!m.key.fromMe }));
    return { messages, exhausted, oldest: Number.isFinite(oldestTs) ? new Date(oldestTs * 1000) : undefined, chatIds: [...jids] };
  }

  /**
   * Tudo o que o banco da Evolution tem do número numa janela, de todos os chats
   * (docs/historico-de-mensagens.md#recuperação). É onde aparece o que o WhatsApp não entregou ao
   * vivo e mandou no lote de histórico do QR seguinte (docs/23-evolution-desempenho.md › 12).
   *
   * O lote de histórico grava o chat só como `@lid`, sem telefone — o webhook ao vivo chega já
   * convertido. O telefone sai de outra mensagem do mesmo chat que a Evolution gravou com
   * `remoteJidAlt`; sem nenhuma, a mensagem é descartada (`unresolved`): criar contato com o LID no
   * lugar do telefone abriria uma conversa fantasma.
   */
  async fetchRecent(ctx: NumberContext, q: RecentQuery): Promise<RecentPage> {
    const POR_PAGINA = 100;
    const MAX_PAGINAS = 40;
    const rows: any[] = [];
    let truncated = false;
    for (let page = 1; ; page++) {
      const res = await this.api<any>(`/chat/findMessages/${this.instance(ctx)}`, {
        method: 'POST',
        // sem `key`: todos os chats. O filtro de horário só vale com gte E lte.
        body: JSON.stringify({ where: { messageTimestamp: { gte: q.since.toISOString(), lte: q.until.toISOString() } }, offset: POR_PAGINA, page }),
      }, this.shard(ctx));
      const records: any[] = Array.isArray(res) ? res : res?.messages?.records ?? [];
      rows.push(...records);
      if (records.length < POR_PAGINA || page >= Number(res?.messages?.pages ?? 0)) break;
      if (page >= MAX_PAGINAS) {
        truncated = true;
        break;
      }
    }

    const telefones = new Map<string, string | null>();
    const messages: InboundMessage[] = [];
    let unresolved = 0;
    for (const r of rows) {
      if (!ehMensagemDeConversa(r)) continue;
      let m = r;
      if (String(r.key.remoteJid).endsWith('@lid')) {
        const pn = await this.telefoneDoLid(ctx, r, telefones);
        if (!pn) {
          unresolved++;
          continue;
        }
        m = { ...r, key: { ...r.key, remoteJid: pn } };
      }
      // `raw` fica o registro original: é com ele que a mídia é buscada depois
      messages.push({ ...this.toInbound(m, ctx.externalId), fromMe: !!r.key.fromMe, raw: r });
    }
    return { messages, unresolved, truncated };
  }

  /** `<telefone>@s.whatsapp.net` de um chat gravado como `@lid`, ou `null`. Cache por chamada de `fetchRecent`. */
  private async telefoneDoLid(ctx: NumberContext, r: any, cache: Map<string, string | null>): Promise<string | null> {
    const pn = (jid: unknown) => (typeof jid === 'string' && jid.endsWith('@s.whatsapp.net') ? jid : null);
    const proprio = pn(r.key.remoteJidAlt) ?? pn(r.key.senderPn);
    if (proprio) return proprio;
    const lid = String(r.key.remoteJid);
    if (cache.has(lid)) return cache.get(lid)!;
    let achado: string | null = null;
    try {
      // as mais recentes podem ser todas do próprio lote do QR (sem telefone): olha mais algumas páginas
      for (let page = 1; page <= 3 && !achado; page++) {
        const res = await this.api<any>(`/chat/findMessages/${this.instance(ctx)}`, {
          method: 'POST',
          // os DOIS campos: com um só, o OR da Evolution ganha um `{}` vazio e devolve todas as mensagens
          body: JSON.stringify({ where: { key: { remoteJid: lid, remoteJidAlt: lid } }, offset: 50, page }),
        }, this.shard(ctx));
        const records: any[] = Array.isArray(res) ? res : res?.messages?.records ?? [];
        for (const x of records) {
          achado = x?.key?.remoteJid === lid ? pn(x.key.remoteJidAlt) ?? pn(x.key.senderPn) : x?.key?.remoteJidAlt === lid ? pn(x.key.remoteJid) : null;
          if (achado) break;
        }
        if (records.length < 50) break;
      }
    } catch {
      /* sem telefone: a mensagem fica de fora */
    }
    cache.set(lid, achado);
    return achado;
  }

  /** Editar mensagem nossa (`POST /chat/updateMessage`). O WhatsApp só aceita até ~15 min depois do envio. */
  async editMessage(ctx: NumberContext, t: OutboundEdit) {
    // `number` com `@` passa direto pelo createJid da Evolution: precisa ser IGUAL ao gravado
    const remoteJid = await this.storedRemoteJid(ctx, t.externalId, t.to);
    await this.api(`/chat/updateMessage/${this.instance(ctx)}`, {
      method: 'POST',
      body: JSON.stringify({ number: remoteJid, text: t.text, key: { id: t.externalId, remoteJid, fromMe: true } }),
    }, this.shard(ctx));
  }

  /**
   * A Evolution não tem rota só para assinar presença; `sendPresence` assina (`presenceSubscribe`)
   * e depois manda o estado pedido. Com `paused` o contato não vê nada.
   */
  async subscribePresence(ctx: NumberContext, phone: string) {
    await this.api(`/chat/sendPresence/${this.instance(ctx)}`, {
      method: 'POST',
      body: JSON.stringify({ number: phone, presence: 'paused', delay: 0 }),
    }, this.shard(ctx));
  }

  /**
   * "digitando…" enquanto o atendente escreve no painel. Sem isto a resposta humana chegava do
   * nada, sem o "digitando" que todo WhatsApp Web real mostra antes — padrão de cliente
   * automatizado. A Evolution segura a requisição pelo `delay` e volta para `paused` sozinha
   * (a v2.3.7 sempre fecha com `paused`) — quem mantém aberto é o laço de NumbersService.setTyping.
   */
  /**
   * Online/offline da conta (`/instance/setPresence`). A instância conecta offline
   * (`alwaysOnline: false` → `markOnlineOnConnect: false`) e o WhatsApp não exibe "digitando" de
   * conta offline — o `delay` acontecia, mas o contato não via nada. Quem liga e desliga é
   * NumbersService.markOnline: online só enquanto há envio/digitação, como uma pessoa.
   */
  async setOnline(ctx: NumberContext, online: boolean) {
    await this.api(`/instance/setPresence/${this.instance(ctx)}`, {
      method: 'POST',
      body: JSON.stringify({ presence: online ? 'available' : 'unavailable' }),
    }, this.shard(ctx));
  }

  async sendTyping(ctx: NumberContext, phone: string, ms: number, state: 'composing' | 'paused' = 'composing') {
    await this.api(`/chat/sendPresence/${this.instance(ctx)}`, {
      method: 'POST',
      body: JSON.stringify({ number: phone, presence: state, delay: state === 'paused' ? 0 : ms }),
    }, this.shard(ctx), state === 'paused' ? 0 : ms);
  }

  /**
   * Agenda inteira da instância (`POST /chat/findContacts` sem filtro): telefone + nome.
   * Mesmo filtro do webhook `contacts.upsert` — só `@s.whatsapp.net` (sem grupo, status, @lid)
   * e só nome que não seja o próprio número.
   */
  async listContacts(ctx: NumberContext) {
    const rows = await this.api<any[]>(`/chat/findContacts/${this.instance(ctx)}`, { method: 'POST', body: JSON.stringify({ where: {} }) }, this.shard(ctx));
    const out: { phone: string; name: string }[] = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      const jid = String(r?.remoteJid ?? '');
      if (!jid.endsWith('@s.whatsapp.net')) continue;
      const phone = jid.replace(/@.*$/, '');
      const name = typeof r?.pushName === 'string' ? r.pushName.trim() : '';
      if (nomeDeContatoValido(name, phone)) out.push({ phone, name });
    }
    return out;
  }

  /** Grupos da instância (`GET /group/fetchAllGroups`), sem participantes — só o necessário para a lista. */
  async listGroups(ctx: NumberContext) {
    const rows = await this.api<any[]>(`/group/fetchAllGroups/${this.instance(ctx)}?getParticipants=false`, undefined, this.shard(ctx));
    return parseGroupList(rows);
  }

  /** Nome guardado pela Evolution para o contato (`POST /chat/findContacts`). */
  async contactName(ctx: NumberContext, phone: string) {
    const rows = await this.api<any[]>(`/chat/findContacts/${this.instance(ctx)}`, {
      method: 'POST',
      body: JSON.stringify({ where: { remoteJid: `${phone.replace(/\D/g, '')}@s.whatsapp.net` } }),
    }, this.shard(ctx));
    const name = (Array.isArray(rows) ? rows : []).map((r) => (typeof r?.pushName === 'string' ? r.pushName.trim() : '')).find((n) => nomeDeContatoValido(n, phone));
    return name || undefined;
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
    const out: ParsedWebhook = { messages: [], statuses: [], reactions: [] };
    const externalNumberId: string = body?.instance;
    const data = body?.data;

    switch (body?.event) {
      case 'messages.upsert': {
        const items = Array.isArray(data) ? data : [data];
        for (const m of items) {
          if (!m?.key) continue;
          // grupo: só chega aqui o liberado para as conversas — o resto morreu no filtro do
          // webhook (group-filter.ts, docs/grupos.md)
          // reação chega como mensagem, mas não é: vira marca na mensagem reagida
          const reacao = desembrulhar(m.message)?.reactionMessage;
          if (reacao) {
            if (reacao.key?.id) {
              out.reactions.push({
                provider: 'evolution',
                externalNumberId,
                targetExternalId: reacao.key.id,
                from: String(m.key.remoteJid).replace(/@.*$/, ''),
                fromMe: !!m.key.fromMe,
                emoji: reacao.text ?? '',
                timestamp: new Date(Number(m.messageTimestamp) * 1000),
              });
            }
            continue;
          }
          // protocolMessage (apagar, editar, config. de temporárias) também não é mensagem:
          // edição troca o texto da original; o resto é descartado em vez de virar bolha solta
          if (desembrulhar(m.message)?.protocolMessage) {
            const edicao = lerEdicao(m.message);
            if (edicao) (out.edits ??= []).push({ provider: 'evolution', externalNumberId, ...edicao });
            continue;
          }
          if (eventoCifrado(m.message)) continue;
          // `fromMe` cobre DOIS casos: o que o painel acabou de enviar (descartado adiante
          // pelo externalId, que já está no banco) e o que a pessoa digitou no celular, que
          // precisa aparecer no histórico. Filtrar aqui jogava os dois fora.
          out.messages.push({ ...this.toInbound(m, externalNumberId), fromMe: !!m.key.fromMe });
        }
        break;
      }
      // Edição pelo evento próprio (WEBHOOK_EVENTS_MESSAGES_EDITED). O formato varia entre
      // versões: o protocolMessage puro, ou embrulhado como mensagem ({ key, message }).
      case 'messages.edited': {
        const items = Array.isArray(data) ? data : [data];
        for (const d of items) {
          const edicao = lerEdicao(d?.message) ?? lerEdicao({ protocolMessage: d }) ?? lerEdicao({ protocolMessage: d?.protocolMessage });
          if (edicao) (out.edits ??= []).push({ provider: 'evolution', externalNumberId, ...edicao });
          // formato que ainda não conhecemos: registra para ajustar o parser, sem virar bolha
          else this.logger.warn(`messages.edited sem texto reconhecível: ${JSON.stringify(d).slice(0, 800)}`);
        }
        break;
      }
      // Sincronização de contatos. Vem da agenda do celular (`contact.name`) MAS a Evolution
      // também dispara estes eventos a cada mensagem, com o pushName — e manda o próprio número
      // quando não há nome. Aqui só filtra o lixo; a separação agenda × pushName é no service.
      case 'contacts.upsert':
      case 'contacts.update': {
        const items = Array.isArray(data) ? data : [data];
        for (const c of items) {
          const jid = String(c?.remoteJid ?? '');
          // @lid não diz o telefone; grupos e status não são contato
          if (!jid.endsWith('@s.whatsapp.net')) continue;
          const name = typeof c?.pushName === 'string' ? c.pushName.trim() : '';
          const phone = jid.replace(/@.*$/, '');
          if (!nomeDeContatoValido(name, phone)) continue;
          (out.contactNames ??= []).push({ externalNumberId, phone, name });
        }
        break;
      }
      case 'messages.update': {
        const items = Array.isArray(data) ? data : [data];
        for (const u of items) {
          const id = u?.keyId ?? u?.key?.id;
          if (!id) continue;
          out.statuses.push({ provider: 'evolution', externalNumberId, externalId: id, status: this.mapAck(u.status), timestamp: new Date() });
        }
        break;
      }
      case 'connection.update': {
        const phone = typeof data?.wuid === 'string' ? data.wuid.replace(/@.*$/, '') : undefined;
        // 401/402/403/406: a Evolution não reconecta e apaga as credenciais (connection-events.ts)
        const reason = Number(data?.statusReason);
        const statusReason = Number.isFinite(reason) ? reason : undefined;
        const loggedOut = isDefinitiveClose(data?.state, statusReason);
        out.connection = {
          externalNumberId, status: this.mapConnection(data?.state), phone, transient: data?.state === 'connecting', loggedOut,
          state: typeof data?.state === 'string' ? data.state : undefined, statusReason, at: typeof body?.date_time === 'string' ? body.date_time : undefined,
          order: connectionOrder(data),
        };
        break;
      }
      case 'presence.update': {
        // { id: '<jid do chat>', presences: { '<jid>': { lastKnownPresence: 'composing' | 'recording' | 'paused' | 'available' | ... } } }
        const chat = String(data?.id ?? '');
        if (!chat || chat.endsWith('@g.us')) break;
        const presences = data?.presences ?? {};
        const p = presences[chat] ?? Object.values(presences)[0];
        const last = (p as any)?.lastKnownPresence;
        // available/unavailable (online/offline) também encerram o "digitando"
        const state = last === 'composing' || last === 'recording' ? last : 'paused';
        out.presences = [{ provider: 'evolution', externalNumberId, from: chat.replace(/@.*$/, ''), state }];
        break;
      }
      case 'qrcode.updated':
        out.connection = { externalNumberId, status: NumberStatus.PENDING_QR, qrCode: data?.qrcode?.base64 };
        break;
    }
    return out;
  }

  private toInbound(m: any, externalNumberId: string): InboundMessage {
    const msg = desembrulhar(m.message);
    const jid = String(m.key.remoteJid);
    const grupo = jid.endsWith('@g.us');
    // grupo é identificado pelo jid inteiro: o número do grupo não é telefone de ninguém
    const from = grupo ? jid : jid.replace(/@.*$/, '');
    const lido = lerConteudo(m.message);
    // resposta em texto puro: o contexto (citação, status) vem no topo do webhook, fora de `message`
    const citacao = lerCitacao(msg, m.contextInfo);
    return {
      provider: 'evolution',
      externalId: m.key.id,
      externalNumberId,
      from,
      // em mensagem nossa (`fromMe`) o pushName é o NOSSO nome, não o do contato: o contato
      // nascia chamado "Tiago" quando a conversa começava pelo celular do cliente
      // grupo: o pushName é de quem escreveu, não o nome do grupo
      contactName: m.key.fromMe || grupo ? undefined : m.pushName,
      ...(grupo && !m.key.fromMe && { group: remetenteDoGrupo(m) }),
      type: lido.type,
      text: lido.text,
      media: lido.media ? { ...lido.media, providerMediaId: m.key.id } : undefined,
      content: lido.content,
      forwarded: lido.forwarded,
      forwardingScore: lido.forwardingScore,
      interactiveReplyId: lido.interactiveReplyId,
      quotedExternalId: citacao?.externalId,
      quotedPreview: citacao?.preview,
      quotedFromStatus: citacao?.fromStatus,
      quotedMedia: citacao?.media,
      referral: this.referralOf(msg, m.contextInfo),
      timestamp: new Date(Number(m.messageTimestamp) * 1000),
      raw: m,
    };
  }

  /**
   * Via Baileys, um clique em anúncio chega com `contextInfo.externalAdReply`
   * (title, body, sourceUrl, sourceId, ctwaClid) ou `conversionSource`. Menos completo que a Meta,
   * mas suficiente para marcar a origem. Em texto puro o `contextInfo` vem no topo do webhook
   * (`externo`), igual à citação.
   */
  private referralOf(msg: any, externo?: any): InboundMessage['referral'] | undefined {
    const ctx = contextoDaCitacao(msg, externo);
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
    // ordem do Baileys: 0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED.
    // PLAYED (áudio ouvido) é lido para o painel; sem isso caía em PENDING e era ignorado.
    if (v === 'READ' || v === '4' || v === 'PLAYED' || v === '5') return MessageStatus.READ;
    if (v === 'DELIVERY_ACK' || v === '3') return MessageStatus.DELIVERED;
    if (v === 'SERVER_ACK' || v === '2') return MessageStatus.SENT;
    if (v === 'ERROR' || v === '0') return MessageStatus.FAILED;
    return MessageStatus.PENDING;
  }

  private mapConnection(state?: string): NumberStatus {
    if (state === 'open') return NumberStatus.CONNECTED;
    if (state === 'connecting') return NumberStatus.PENDING_QR;
    return NumberStatus.DISCONNECTED;
  }
}

/**
 * Prazo de cada chamada à Evolution. Sem prazo, uma Evolution travada segurava envio, health check
 * e worker pelo limite do undici (5 min) — e, no envio, o retry vinha depois sem saber se saiu.
 * Mídia, agenda/grupos inteiros e o restart (o patch espera até ~5 s) ganham prazo maior.
 */
export const EVOLUTION_TIMEOUT_MS = 15_000;
export const EVOLUTION_MEDIA_TIMEOUT_MS = 60_000;
const ROTAS_LENTAS = /^\/(message\/(sendMedia|sendWhatsAppAudio)|chat\/(getBase64FromMediaMessage|findContacts)|group\/fetchAllGroups|instance\/restart)\//;

export function evolutionTimeoutMs(path: string, delayMs = 0): number {
  return (ROTAS_LENTAS.test(path) ? EVOLUTION_MEDIA_TIMEOUT_MS : EVOLUTION_TIMEOUT_MS) + Math.max(0, delayMs);
}

const isAbort = (err: unknown) => err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');

/**
 * Traduz a falha do fetch. Prazo estourado vira `ProviderTimeoutError`: a Evolution pode ter feito
 * a operação (no envio, a mensagem pode ter saído) — quem chama não deve repetir às cegas. Conexão
 * recusada / DNS antes de enviar qualquer coisa: a requisição não chegou, repetir é seguro
 * (`isTransientSendError` reconhece o código no texto).
 */
export function evolutionFetchError(err: unknown, path: string, timeoutMs: number): Error {
  const rota = path.split('/').slice(1, 3).join('/');
  if (isAbort(err)) return new ProviderTimeoutError(`Evolution não respondeu em ${Math.round(timeoutMs / 1000)} s (${rota}) — a operação pode ter sido feita; confira antes de repetir`);
  const code = (err as { cause?: { code?: string } })?.cause?.code;
  if (code && /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN)$/.test(code)) return new Error(`Evolution indisponível (${code}) em ${rota}`);
  return err instanceof Error ? err : new Error(String(err));
}

/** Carimbo da guarda de conexão (atendoBoot/atendoSeq inteiros positivos); imagem sem a guarda → undefined. */
export function connectionOrder(data: any): { boot: number; seq: number; gen?: number } | undefined {
  const boot = Number(data?.atendoBoot);
  const seq = Number(data?.atendoSeq);
  if (!Number.isSafeInteger(boot) || !Number.isSafeInteger(seq) || boot <= 0 || seq <= 0) return undefined;
  const gen = Number(data?.atendoGen);
  return { boot, seq, ...(Number.isSafeInteger(gen) && gen >= 0 ? { gen } : {}) };
}

/** Resposta do `fetchAllGroups` → só grupos válidos (`@g.us`), sem repetição. */
/**
 * Quem escreveu no grupo. O Baileys põe o autor em `key.participant`, que pode vir como @lid
 * (sem telefone); aí o telefone, quando há, está em `participantAlt`/`participantPn`.
 */
export function remetenteDoGrupo(m: any): { senderPhone?: string; senderName?: string } {
  const jids = [m?.key?.participant, m?.key?.participantAlt, m?.key?.participantPn, m?.participant].filter((j): j is string => typeof j === 'string');
  const pn = jids.find((j) => j.endsWith('@s.whatsapp.net'));
  const nome = typeof m?.pushName === 'string' ? m.pushName.trim() : '';
  return { senderPhone: pn ? pn.replace(/@.*$/, '').split(':')[0] : undefined, senderName: nome || undefined };
}

export function parseGroupList(rows: unknown): { jid: string; name: string; size: number }[] {
  const out = new Map<string, { jid: string; name: string; size: number }>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const jid = String((r as any)?.id ?? '');
    if (!jid.endsWith('@g.us')) continue;
    const name = typeof (r as any)?.subject === 'string' && (r as any).subject.trim() ? (r as any).subject.trim() : jid.replace(/@.*$/, '');
    const size = Number((r as any)?.size ?? (r as any)?.participants?.length ?? 0);
    out.set(jid, { jid, name: name.slice(0, 120), size: Number.isFinite(size) ? size : 0 });
  }
  return [...out.values()];
}

/**
 * Registro do histórico que vira bolha: o mesmo filtro do `messages.upsert`, sem os desvios —
 * reação e edição de mensagem antiga são descartadas em vez de aplicadas.
 */
function ehMensagemDeConversa(m: any): boolean {
  const jid = String(m?.key?.remoteJid ?? '');
  if (!m?.key?.id || !m.message || jid.endsWith('@g.us') || jid.startsWith('status@')) return false;
  const msg = desembrulhar(m.message);
  return !msg?.reactionMessage && !msg?.protocolMessage && !eventoCifrado(m.message);
}

export function nomeDeContatoValido(name: string, phone: string): boolean {
  const n = name.trim();
  if (!n || n.length > 80) return false;
  const digitos = n.replace(/\D/g, '');
  return !(digitos.length >= 8 && digitos === n.replace(/[\s+()-]/g, '')) && digitos !== phone;
}

/**
 * Menu → `POST /message/sendButtons` com botões `reply` (o Baileys monta nativeFlow quick_reply).
 * O título é o cabeçalho do menu ou a 1ª linha do texto; o resto vai na descrição. Rótulo do
 * botão até 20 caracteres, como na Meta (o WhatsApp corta maior).
 */
export function menuButtonsPayload(m: Pick<OutboundMessage, 'text' | 'interactive'>) {
  const text = (m.text ?? '').trim();
  const [primeira, ...resto] = text.split('\n');
  const header = m.interactive?.header?.trim();
  return {
    title: (header || primeira || 'Escolha uma opção').slice(0, 60),
    description: (header ? text : resto.join('\n').trim()) || undefined,
    footer: m.interactive?.footer?.slice(0, 60) || undefined,
    buttons: (m.interactive?.options ?? []).slice(0, 3).map((o) => ({ type: 'reply', displayText: o.title.slice(0, 20), id: o.id.slice(0, 256) })),
  };
}
