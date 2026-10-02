import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { MessageStatus, MessageType, NumberStatus, BillingCategory } from '@atendo/shared';
import { EvolutionProvider } from '../src/modules/whatsapp/providers/evolution.provider';
import type { NumberContext } from '../src/modules/whatsapp/providers/provider.interface';

const provider = new EvolutionProvider();
const INSTANCE = 'tenant-1-num-1';

const ctx: NumberContext = {
  numberId: 'num-1',
  tenantId: 'tenant-1',
  phone: '5500000000000',
  externalId: INSTANCE,
  config: { instanceName: INSTANCE },
};

function upsert(message: Record<string, unknown>, key: Record<string, unknown> = {}) {
  return {
    event: 'messages.upsert',
    instance: INSTANCE,
    data: { key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'EVO1', ...key }, pushName: 'Bruno', messageTimestamp: 1758300000, message },
  };
}

describe('EvolutionProvider.parseWebhook — mensagens', () => {
  it('lê texto simples', () => {
    const out = provider.parseWebhook(upsert({ conversation: 'oi' }));
    const m = out.messages[0];
    expect(m.provider).toBe('evolution');
    expect(m.externalNumberId).toBe(INSTANCE);
    expect(m.from).toBe('5511999999999');
    expect(m.contactName).toBe('Bruno');
    expect(m.type).toBe(MessageType.TEXT);
    expect(m.text).toBe('oi');
  });

  it('lê texto estendido (resposta/citação) com o id da mensagem citada', () => {
    const out = provider.parseWebhook(upsert({ extendedTextMessage: { text: '1', contextInfo: { stanzaId: 'EVO0' } } }));
    expect(out.messages[0].text).toBe('1');
    expect(out.messages[0].quotedExternalId).toBe('EVO0');
  });

  it('marca o que saiu do número em vez de descartar — o aparelho do cliente também fala ali', () => {
    // descartar aqui fazia o painel mostrar metade da conversa: sumiam as respostas que o
    // cliente digitava no celular. O robô não responde a si mesmo porque o InboundProcessor
    // pula a automação quando `fromMe`, não porque a mensagem deixa de existir.
    const [m] = provider.parseWebhook(upsert({ conversation: 'eco' }, { fromMe: true })).messages;
    expect(m.fromMe).toBe(true);
  });

  it('ignora grupos', () => {
    expect(provider.parseWebhook(upsert({ conversation: 'oi' }, { remoteJid: '12036304@g.us' })).messages).toHaveLength(0);
  });

  it('classifica os tipos de mídia', () => {
    const cases: [Record<string, unknown>, MessageType][] = [
      [{ imageMessage: { mimetype: 'image/jpeg', caption: 'foto' } }, MessageType.IMAGE],
      [{ audioMessage: { mimetype: 'audio/ogg' } }, MessageType.AUDIO],
      [{ videoMessage: { mimetype: 'video/mp4' } }, MessageType.VIDEO],
      [{ documentMessage: { mimetype: 'application/pdf', fileName: 'orcamento.pdf' } }, MessageType.DOCUMENT],
      [{ stickerMessage: {} }, MessageType.STICKER],
      [{ locationMessage: { degreesLatitude: -16.6, degreesLongitude: -49.2 } }, MessageType.LOCATION],
    ];
    for (const [msg, type] of cases) expect(provider.parseWebhook(upsert(msg)).messages[0].type).toBe(type);
  });

  it('usa a legenda como texto da mensagem de mídia', () => {
    expect(provider.parseWebhook(upsert({ imageMessage: { mimetype: 'image/jpeg', caption: 'foto' } })).messages[0].text).toBe('foto');
  });

  it('lê coordenadas de localização', () => {
    const m = provider.parseWebhook(upsert({ locationMessage: { degreesLatitude: -16.6, degreesLongitude: -49.2 } })).messages[0];
    expect(m.location).toEqual({ lat: -16.6, lng: -49.2 });
  });

  it('marca origem de anúncio pelo externalAdReply', () => {
    const m = provider.parseWebhook(
      upsert({ extendedTextMessage: { text: 'oi', contextInfo: { externalAdReply: { title: 'Corte + barba', body: 'promo', sourceUrl: 'https://facebook.com/ads/x', ctwaClid: 'clid-1' } } } }),
    ).messages[0];
    expect(m.referral).toMatchObject({ sourceType: 'ad', headline: 'Corte + barba', ctwaClid: 'clid-1' });
  });

  it('link comum não é marcado como anúncio', () => {
    const m = provider.parseWebhook(
      upsert({ extendedTextMessage: { text: 'oi', contextInfo: { externalAdReply: { title: 'Site', sourceUrl: 'https://barbearia.com.br' } } } }),
    ).messages[0];
    expect(m.referral?.sourceType).toBe('link');
  });

  it('aceita lote de mensagens (data como array)', () => {
    const body = { event: 'messages.upsert', instance: INSTANCE, data: [upsert({ conversation: 'a' }).data, upsert({ conversation: 'b' }).data] };
    expect(provider.parseWebhook(body).messages.map((m) => m.text)).toEqual(['a', 'b']);
  });
});

describe('EvolutionProvider.parseWebhook — status e conexão', () => {
  it('mapeia os acks numéricos e textuais', () => {
    const st = (status: unknown) => provider.parseWebhook({ event: 'messages.update', instance: INSTANCE, data: { keyId: 'EVO1', status } }).statuses[0].status;
    expect(st('READ')).toBe(MessageStatus.READ);
    expect(st(4)).toBe(MessageStatus.READ);
    expect(st('DELIVERY_ACK')).toBe(MessageStatus.DELIVERED);
    expect(st(3)).toBe(MessageStatus.DELIVERED);
    expect(st('SERVER_ACK')).toBe(MessageStatus.SENT);
    expect(st('ERROR')).toBe(MessageStatus.FAILED);
    expect(st('QUALQUER_COISA')).toBe(MessageStatus.PENDING);
  });

  it('ignora update sem id de mensagem', () => {
    expect(provider.parseWebhook({ event: 'messages.update', instance: INSTANCE, data: { status: 'READ' } }).statuses).toHaveLength(0);
  });

  it('conexão aberta informa o telefone real que pareou', () => {
    const c = provider.parseWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'open', wuid: '5562999998888@s.whatsapp.net' } }).connection;
    expect(c).toMatchObject({ externalNumberId: INSTANCE, status: NumberStatus.CONNECTED, phone: '5562999998888', transient: false, loggedOut: false });
  });

  it('"connecting" é transitório — não pode derrubar um número já conectado', () => {
    const c = provider.parseWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'connecting' } }).connection;
    expect(c?.transient).toBe(true);
  });

  it('desconexão com statusReason 401 marca logout (precisa de QR novo)', () => {
    const c = provider.parseWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'close', statusReason: 401 } }).connection;
    expect(c).toMatchObject({ status: NumberStatus.DISCONNECTED, loggedOut: true });
  });

  it('queda comum (sem 401) não marca logout', () => {
    const c = provider.parseWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'close', statusReason: 428 } }).connection;
    expect(c?.loggedOut).toBe(false);
  });

  it('qrcode.updated devolve o QR', () => {
    const c = provider.parseWebhook({ event: 'qrcode.updated', instance: INSTANCE, data: { qrcode: { base64: 'data:image/png;base64,AAA' } } }).connection;
    expect(c).toMatchObject({ status: NumberStatus.PENDING_QR, qrCode: 'data:image/png;base64,AAA' });
  });

  it('evento desconhecido ou corpo vazio não quebra', () => {
    for (const body of [undefined, null, {}, { event: 'contacts.upsert', instance: INSTANCE, data: {} }]) {
      expect(provider.parseWebhook(body)).toEqual({ messages: [], statuses: [] });
    }
  });
});

describe('EvolutionProvider.verifyWebhook', () => {
  const token = (instance: string) => createHmac('sha256', process.env.EVOLUTION_API_KEY!).update(instance).digest('hex');
  const body = (o: unknown) => Buffer.from(JSON.stringify(o));

  it('aceita a chave global no header (chamada manual/teste)', () => {
    expect(() => provider.verifyWebhook({ apikey: process.env.EVOLUTION_API_KEY! }, body({}))).not.toThrow();
  });

  it('aceita o token da instância vindo no corpo (é assim que a Evolution manda)', () => {
    expect(() => provider.verifyWebhook({}, body({ instance: INSTANCE, apikey: token(INSTANCE) }))).not.toThrow();
  });

  it('recusa token de outra instância', () => {
    expect(() => provider.verifyWebhook({}, body({ instance: INSTANCE, apikey: token('outra-instancia') }))).toThrow();
  });

  it('recusa corpo sem autenticação, com chave errada ou inválido', () => {
    expect(() => provider.verifyWebhook({}, body({ instance: INSTANCE }))).toThrow();
    expect(() => provider.verifyWebhook({ apikey: 'errada' }, body({}))).toThrow();
    expect(() => provider.verifyWebhook({}, Buffer.from('não é json'))).toThrow();
  });
});

describe('EvolutionProvider.send', () => {
  let calls: { path: string; body: any }[] = [];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      calls.push({ path: String(url), body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ key: { id: 'EVO-ENVIADA' } }) } as any;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('texto vai por sendText e não gera custo de provider', async () => {
    const res = await provider.send(ctx, { to: '5511999999999', type: MessageType.TEXT, text: 'olá' } as any);
    expect(calls[0].path).toContain(`/message/sendText/${INSTANCE}`);
    expect(calls[0].body).toMatchObject({ number: '5511999999999', text: 'olá' });
    expect(res).toEqual({ externalId: 'EVO-ENVIADA', status: MessageStatus.SENT, billingCategory: BillingCategory.UNOFFICIAL });
  });

  it('menu vira lista numerada — conta não-oficial não recebe botão de forma confiável', async () => {
    await provider.send(ctx, {
      to: '5511999999999',
      type: MessageType.TEXT,
      text: 'Qual serviço?',
      interactive: { options: [{ id: 'a', title: 'Corte' }, { id: 'b', title: 'Barba' }] },
    } as any);
    expect(calls[0].body.text).toBe('Qual serviço?\n\n1 - Corte\n2 - Barba');
  });

  it('áudio vai como mensagem de voz (PTT)', async () => {
    await provider.send(ctx, { to: '5511999999999', type: MessageType.AUDIO } as any, { data: Buffer.from('audio'), mimeType: 'audio/ogg' });
    expect(calls[0].path).toContain('/message/sendWhatsAppAudio/');
    expect(calls[0].body.audio).toBe(Buffer.from('audio').toString('base64'));
  });

  it('mídia sobe em base64 — nunca expõe a URL do nosso storage', async () => {
    await provider.send(ctx, { to: '5511999999999', type: MessageType.IMAGE, media: { caption: 'olha' } } as any, { data: Buffer.from('img'), mimeType: 'image/png', fileName: 'a.png' });
    expect(calls[0].path).toContain('/message/sendMedia/');
    expect(calls[0].body).toMatchObject({ mediatype: 'image', media: Buffer.from('img').toString('base64'), mimetype: 'image/png', fileName: 'a.png', caption: 'olha' });
  });

  it('usa o shard configurado no número em vez do servidor padrão', async () => {
    await provider.send({ ...ctx, config: { instanceName: INSTANCE, baseUrl: 'http://evo-2:8080', apiKey: 'chave-do-shard' } }, { to: '5511999999999', type: MessageType.TEXT, text: 'oi' } as any);
    expect(calls[0].path.startsWith('http://evo-2:8080')).toBe(true);
  });

  it('erro da Evolution vira exceção com a mensagem da API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ response: { message: ['Connection Closed'] } }) }) as any));
    await expect(provider.send(ctx, { to: '55119', type: MessageType.TEXT, text: 'x' } as any)).rejects.toThrow('Connection Closed');
  });
});
