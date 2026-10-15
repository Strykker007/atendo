import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvolutionProvider } from '../src/modules/whatsapp/providers/evolution.provider';
import type { NumberContext } from '../src/modules/whatsapp/providers/provider.interface';

const provider = new EvolutionProvider();
const ctx: NumberContext = { numberId: 'num-1', tenantId: 'tenant-1', phone: '5500000000000', externalId: 'inst-1', config: { instanceName: 'inst-1' } };

const rec = (id: string, ts: number, message: Record<string, unknown>, key: Record<string, unknown> = {}) => ({
  key: { id, fromMe: false, remoteJid: '5562999998888@s.whatsapp.net', ...key },
  pushName: 'Ana',
  messageTimestamp: ts,
  message,
});

/** responde ao findMessages por remoteJid; a busca do @lid (storedRemoteJid) devolve o registro conhecido */
function mockEvolution(porJid: Record<string, unknown[]>, conhecido?: unknown) {
  const bodies: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    const records = body.where?.key?.id ? (conhecido ? [conhecido] : []) : porJid[body.where.key.remoteJid] ?? [];
    return new Response(JSON.stringify({ messages: { records } }), { status: 200 });
  }));
  return bodies;
}

afterEach(() => vi.unstubAllGlobals());

describe('EvolutionProvider.fetchHistory', () => {
  it('busca o telefone com e sem o nono dígito e o @lid das mensagens que já temos', async () => {
    const bodies = mockEvolution({}, rec('K1', 100, { conversation: 'x' }, { remoteJid: '1234@lid' }));
    await provider.fetchHistory(ctx, { phone: '5562999998888', before: new Date(2_000_000), limit: 10, knownExternalIds: ['K1'] });
    const jids = bodies.filter((b) => !b.where.key.id).map((b) => b.where.key.remoteJid);
    expect(jids.sort()).toEqual(['1234@lid', '556299998888@s.whatsapp.net', '5562999998888@s.whatsapp.net']);
    // filtro de horário só funciona na Evolution com gte e lte
    expect(bodies.at(-1).where.messageTimestamp).toEqual({ gte: new Date(0).toISOString(), lte: new Date(2_000_000).toISOString() });
  });

  it('descarta reação, edição e grupo; junta os chats sem repetir e ordena da mais nova para a mais antiga', async () => {
    mockEvolution({
      '5562999998888@s.whatsapp.net': [
        rec('A', 300, { conversation: 'terceira' }),
        rec('R', 250, { reactionMessage: { key: { id: 'A' }, text: '👍' } }),
        rec('B', 100, { conversation: 'primeira' }, { fromMe: true }),
      ],
      '556299998888@s.whatsapp.net': [rec('C', 200, { conversation: 'segunda' }), rec('A', 300, { conversation: 'terceira' })],
    });
    const page = await provider.fetchHistory(ctx, { phone: '5562999998888', before: new Date(), limit: 10, knownExternalIds: [] });
    expect(page.messages.map((m) => m.externalId)).toEqual(['A', 'C', 'B']);
    expect(page.messages[2].fromMe).toBe(true);
    expect(page.exhausted).toBe(true);
    expect(page.oldest).toEqual(new Date(100_000));
  });

  it('página cheia não é o fim; o mais antigo lido conta mesmo se for descartado', async () => {
    mockEvolution({
      '5562999998888@s.whatsapp.net': [rec('A', 300, { conversation: 'oi' }), rec('P', 50, { protocolMessage: { type: 0 } })],
    });
    const page = await provider.fetchHistory(ctx, { phone: '5562999998888', before: new Date(), limit: 2, knownExternalIds: [] });
    expect(page.exhausted).toBe(false);
    expect(page.messages.map((m) => m.externalId)).toEqual(['A']);
    expect(page.oldest).toEqual(new Date(50_000));
  });
});
