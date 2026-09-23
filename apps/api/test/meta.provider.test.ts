import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { MessageStatus, MessageType, BillingCategory } from '@atendo/shared';
import { MetaProvider } from '../src/modules/whatsapp/providers/meta.provider';
import type { NumberContext } from '../src/modules/whatsapp/providers/provider.interface';

const provider = new MetaProvider();

const ctx: NumberContext = {
  numberId: 'num-1',
  tenantId: 'tenant-1',
  phone: '5500000000000',
  externalId: 'pnid-1',
  config: { accessToken: 'token-de-teste', phoneNumberId: 'pnid-1', wabaId: 'waba-1' },
};

/** Payload real da Meta, reduzido ao que o adapter lê. */
function webhook(value: Record<string, unknown>) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '5500000000000', phone_number_id: 'pnid-1' }, ...value } }] }] };
}

describe('MetaProvider.parseWebhook', () => {
  it('lê mensagem de texto com nome do contato', () => {
    const out = provider.parseWebhook(
      webhook({
        contacts: [{ profile: { name: 'Bruno' }, wa_id: '5511999999999' }],
        messages: [{ from: '5511999999999', id: 'wamid.1', timestamp: '1758300000', type: 'text', text: { body: 'oi' } }],
      }),
    );
    expect(out.messages).toHaveLength(1);
    const m = out.messages[0];
    expect(m.provider).toBe('meta');
    expect(m.externalId).toBe('wamid.1');
    expect(m.externalNumberId).toBe('pnid-1');
    expect(m.from).toBe('5511999999999');
    expect(m.contactName).toBe('Bruno');
    expect(m.type).toBe(MessageType.TEXT);
    expect(m.text).toBe('oi');
    expect(m.timestamp.toISOString()).toBe('2025-09-19T16:40:00.000Z'); // unix em segundos, não ms
  });

  it('trata resposta de botão como texto, guardando o id da opção', () => {
    const out = provider.parseWebhook(
      webhook({
        messages: [{ from: '5511999999999', id: 'wamid.2', timestamp: '1758300000', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Sim, confirmar' } } }],
      }),
    );
    const m = out.messages[0];
    expect(m.type).toBe(MessageType.TEXT);
    expect(m.text).toBe('Sim, confirmar');
    expect(m.interactiveReplyId).toBe('yes');
  });

  it('trata resposta de lista igual à de botão', () => {
    const out = provider.parseWebhook(
      webhook({
        messages: [{ from: '5511999999999', id: 'wamid.3', timestamp: '1758300000', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: '2026-09-22T14:00:00.000Z', title: 'seg. 22/09 11:00' } } }],
      }),
    );
    expect(out.messages[0].interactiveReplyId).toBe('2026-09-22T14:00:00.000Z');
    expect(out.messages[0].text).toBe('seg. 22/09 11:00');
  });

  it('lê imagem com legenda e id de mídia', () => {
    const out = provider.parseWebhook(
      webhook({
        messages: [{ from: '5511999999999', id: 'wamid.4', timestamp: '1758300000', type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'olha isso' } }],
      }),
    );
    const m = out.messages[0];
    expect(m.type).toBe(MessageType.IMAGE);
    expect(m.media).toEqual({ providerMediaId: 'media-1', mimeType: 'image/jpeg', fileName: undefined, caption: 'olha isso' });
    expect(m.text).toBe('olha isso');
  });

  it('marca origem de anúncio (Click-to-WhatsApp)', () => {
    const out = provider.parseWebhook(
      webhook({
        messages: [{ from: '5511999999999', id: 'wamid.5', timestamp: '1758300000', type: 'text', text: { body: 'quero saber do corte' }, referral: { source_type: 'ad', source_id: '120200', headline: 'Corte + barba', body: 'promo', ctwa_clid: 'clid-1', image_url: 'https://exemplo/i.jpg' } }],
      }),
    );
    expect(out.messages[0].referral).toMatchObject({ sourceType: 'ad', sourceId: '120200', headline: 'Corte + barba', ctwaClid: 'clid-1', mediaUrl: 'https://exemplo/i.jpg' });
  });

  it('tipo desconhecido não quebra o parse', () => {
    const out = provider.parseWebhook(webhook({ messages: [{ from: '551199', id: 'wamid.6', timestamp: '1758300000', type: 'reaction', reaction: { emoji: '👍' } }] }));
    expect(out.messages[0].type).toBe(MessageType.UNKNOWN);
  });

  it('mapeia status de entrega e erro', () => {
    const out = provider.parseWebhook(
      webhook({
        statuses: [
          { id: 'wamid.a', status: 'delivered', timestamp: '1758300000' },
          { id: 'wamid.b', status: 'read', timestamp: '1758300001' },
          { id: 'wamid.c', status: 'failed', timestamp: '1758300002', errors: [{ title: 'Número inválido' }] },
          { id: 'wamid.d', status: 'algo_novo', timestamp: '1758300003' },
        ],
      }),
    );
    expect(out.statuses.map((s) => s.status)).toEqual([MessageStatus.DELIVERED, MessageStatus.READ, MessageStatus.FAILED, MessageStatus.PENDING]);
    expect(out.statuses[2].error).toBe('Número inválido');
  });

  it('corpo vazio ou inesperado devolve listas vazias em vez de estourar', () => {
    for (const body of [undefined, null, {}, { entry: null }, { entry: [{}] }, { entry: [{ changes: [{ value: {} }] }] }]) {
      const out = provider.parseWebhook(body);
      expect(out).toEqual({ messages: [], statuses: [] });
    }
  });
});

describe('MetaProvider.verifyWebhook', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  const sign = (secret: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

  it('aceita assinatura correta', () => {
    expect(() => provider.verifyWebhook({ 'x-hub-signature-256': sign(process.env.META_APP_SECRET!) }, body)).not.toThrow();
  });

  it('recusa assinatura de outro segredo', () => {
    expect(() => provider.verifyWebhook({ 'x-hub-signature-256': sign('segredo-errado') }, body)).toThrow();
  });

  it('recusa assinatura ausente ou de tamanho diferente (sem estourar no timingSafeEqual)', () => {
    expect(() => provider.verifyWebhook({}, body)).toThrow();
    expect(() => provider.verifyWebhook({ 'x-hub-signature-256': 'sha256=abc' }, body)).toThrow();
  });

  it('recusa corpo adulterado com a mesma assinatura', () => {
    expect(() => provider.verifyWebhook({ 'x-hub-signature-256': sign(process.env.META_APP_SECRET!) }, Buffer.from('{"hello":"mundo"}'))).toThrow();
  });
});

describe('MetaProvider.send', () => {
  let sent: any;
  beforeEach(() => {
    sent = undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      sent = JSON.parse(init.body);
      return { ok: true, json: async () => ({ messages: [{ id: 'wamid.enviado' }] }) } as any;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('texto simples vai como type text e conta como conversa de serviço', async () => {
    const res = await provider.send(ctx, { to: '5511999999999', type: MessageType.TEXT, text: 'olá' } as any);
    expect(sent).toMatchObject({ messaging_product: 'whatsapp', to: '5511999999999', type: 'text', text: { body: 'olá' } });
    expect(res).toEqual({ externalId: 'wamid.enviado', status: MessageStatus.SENT, billingCategory: BillingCategory.SERVICE });
  });

  it('até 3 opções viram botões de resposta', async () => {
    await provider.send(ctx, {
      to: '5511999999999',
      type: MessageType.TEXT,
      text: 'Confirma o horário?',
      interactive: { options: [{ id: 'yes', title: 'Sim, confirmar' }, { id: 'other', title: 'Outro horário' }] },
    } as any);
    expect(sent.type).toBe('interactive');
    expect(sent.interactive.type).toBe('button');
    expect(sent.interactive.body.text).toBe('Confirma o horário?');
    expect(sent.interactive.action.buttons).toEqual([
      { type: 'reply', reply: { id: 'yes', title: 'Sim, confirmar' } },
      { type: 'reply', reply: { id: 'other', title: 'Outro horário' } },
    ]);
  });

  it('4 ou mais opções viram lista com o botão configurado', async () => {
    await provider.send(ctx, {
      to: '5511999999999',
      type: MessageType.TEXT,
      text: 'Escolha o horário',
      interactive: { listButton: 'Ver horários', options: Array.from({ length: 5 }, (_, i) => ({ id: `op-${i}`, title: `Opção ${i}` })) },
    } as any);
    expect(sent.interactive.type).toBe('list');
    expect(sent.interactive.action.button).toBe('Ver horários');
    expect(sent.interactive.action.sections[0].rows).toHaveLength(5);
  });

  it('respeita os limites da Meta: no máximo 10 opções, título do botão em 20 caracteres', async () => {
    await provider.send(ctx, {
      to: '5511999999999',
      type: MessageType.TEXT,
      text: 'x',
      interactive: { options: Array.from({ length: 14 }, (_, i) => ({ id: `op-${i}`, title: `Título bem grande da opção ${i}` })) },
    } as any);
    expect(sent.interactive.action.sections[0].rows).toHaveLength(10);

    await provider.send(ctx, {
      to: '5511999999999',
      type: MessageType.TEXT,
      text: 'x',
      interactive: { options: [{ id: 'a', title: 'Título muito maior que vinte caracteres' }] },
    } as any);
    expect(sent.interactive.action.buttons[0].reply.title).toHaveLength(20);
  });

  it('template usa a categoria de cobrança do próprio template', async () => {
    const res = await provider.send(ctx, {
      to: '5511999999999',
      type: MessageType.TEXT,
      template: { name: 'lembrete', language: 'pt_BR', components: [], category: BillingCategory.UTILITY },
    } as any);
    expect(sent.type).toBe('template');
    expect(res.billingCategory).toBe(BillingCategory.UTILITY);
  });

  it('erro da Meta vira exceção com a mensagem da API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid parameter' } }) }) as any));
    await expect(provider.send(ctx, { to: '55119', type: MessageType.TEXT, text: 'x' } as any)).rejects.toThrow('Invalid parameter');
  });
});
