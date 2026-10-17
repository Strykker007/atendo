import { describe, expect, it } from 'vitest';
import { stripGroupEvents } from '../src/modules/whatsapp/group-filter';
import { parseGroupList } from '../src/modules/whatsapp/providers/evolution.provider';

const msg = (jid: string, id = 'A1') => ({ key: { remoteJid: jid, id, fromMe: false }, message: { conversation: 'oi' }, messageTimestamp: 1 });

describe('stripGroupEvents (docs/grupos.md)', () => {
  it('descarta mensagem de grupo antes da fila', () => {
    expect(stripGroupEvents({ event: 'messages.upsert', instance: 'x', data: msg('120363000000000001@g.us') })).toBeNull();
  });

  it('mantém mensagem de conversa intacta (mesmo objeto)', () => {
    const body = { event: 'messages.upsert', instance: 'x', data: msg('5511999998888@s.whatsapp.net') };
    expect(stripGroupEvents(body)).toBe(body);
  });

  it('lote misto segue só com as conversas', () => {
    const body = { event: 'messages.upsert', instance: 'x', data: [msg('120363000000000001@g.us', 'G'), msg('5511999998888@s.whatsapp.net', 'P')] };
    const out = stripGroupEvents(body) as typeof body;
    expect(out.data.map((m) => m.key.id)).toEqual(['P']);
  });

  it('lote só de grupo vira null', () => {
    expect(stripGroupEvents({ event: 'messages.upsert', data: [msg('1@g.us', 'a'), msg('2@g.us', 'b')] })).toBeNull();
  });

  it('eventos exclusivos de grupo nunca passam', () => {
    for (const event of ['groups.upsert', 'groups.update', 'group-participants.update']) expect(stripGroupEvents({ event, data: {} })).toBeNull();
  });

  it('status e presença de grupo são descartados; os de conversa passam', () => {
    expect(stripGroupEvents({ event: 'messages.update', data: { keyId: 'k', remoteJid: '1@g.us', status: 'READ' } })).toBeNull();
    expect(stripGroupEvents({ event: 'presence.update', data: { id: '1@g.us', presences: {} } })).toBeNull();
    const ok = { event: 'messages.update', data: { keyId: 'k', remoteJid: '5511@s.whatsapp.net', status: 'READ' } };
    expect(stripGroupEvents(ok)).toBe(ok);
  });

  it('não mexe em conexão, QR e contatos', () => {
    const conn = { event: 'connection.update', data: { state: 'open' } };
    expect(stripGroupEvents(conn)).toBe(conn);
    const qr = { event: 'qrcode.updated', data: { qrcode: { base64: 'x' } } };
    expect(stripGroupEvents(qr)).toBe(qr);
  });
});

describe('parseGroupList', () => {
  it('só @g.us, sem repetição, nome do subject ou do id', () => {
    const out = parseGroupList([
      { id: '120363000000000001@g.us', subject: ' Promoções VIP ', size: 42 },
      { id: '120363000000000001@g.us', subject: 'Promoções VIP', size: 43 },
      { id: '120363000000000002@g.us', subject: '' },
      { id: '5511999998888@s.whatsapp.net', subject: 'contato' },
      null,
    ]);
    expect(out).toEqual([
      { jid: '120363000000000001@g.us', name: 'Promoções VIP', size: 43 },
      { jid: '120363000000000002@g.us', name: '120363000000000002', size: 0 },
    ]);
  });

  it('resposta inesperada vira lista vazia', () => {
    expect(parseGroupList({ error: 'x' })).toEqual([]);
  });
});
