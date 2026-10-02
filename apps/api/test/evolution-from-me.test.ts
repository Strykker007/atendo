import { describe, expect, it } from 'vitest';
import { EvolutionProvider } from '../src/modules/whatsapp/providers/evolution.provider';

const provider = new EvolutionProvider();

const upsert = (key: Record<string, unknown>, message: Record<string, unknown> = { conversation: 'oi' }) => ({
  event: 'messages.upsert',
  instance: 'atendo-x-5500000000000',
  data: { key: { id: 'ABC', remoteJid: '5500000000001@s.whatsapp.net', ...key }, message, messageTimestamp: 1_790_000_000 },
});

describe('parseWebhook: mensagem do aparelho', () => {
  it('a recebida do contato entra como recebida', () => {
    const [m] = provider.parseWebhook(upsert({ fromMe: false })).messages;
    expect(m.fromMe).toBe(false);
    expect(m.from).toBe('5500000000001');
  });

  it('a enviada pelo celular do cliente NÃO é descartada — só vem marcada', () => {
    // era aqui que a conversa ficava pela metade: `fromMe` era filtrado e sumia do histórico
    const [m] = provider.parseWebhook(upsert({ fromMe: true })).messages;
    expect(m).toBeDefined();
    expect(m.fromMe).toBe(true);
  });

  it('o telefone continua sendo o do CONTATO, não o do cliente', () => {
    // em `fromMe` o remoteJid é o destinatário; é ele que identifica a conversa
    const [m] = provider.parseWebhook(upsert({ fromMe: true })).messages;
    expect(m.from).toBe('5500000000001');
  });

  it('grupo continua fora do atendimento, inclusive vindo do aparelho', () => {
    const body = upsert({ fromMe: true, remoteJid: '123@g.us' });
    expect(provider.parseWebhook(body).messages).toHaveLength(0);
  });

  it('evento sem key é ignorado', () => {
    expect(provider.parseWebhook({ event: 'messages.upsert', instance: 'x', data: {} }).messages).toHaveLength(0);
  });
});
