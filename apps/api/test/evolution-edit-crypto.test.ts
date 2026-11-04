import { describe, expect, it } from 'vitest';
import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { EvolutionProvider } from '../src/modules/whatsapp/providers/evolution.provider';
import { bytesDe, decifrarEdicao, jidsDaOriginal, lerEdicaoCifrada, precisaDoLid, segredoDaOriginal } from '../src/modules/whatsapp/providers/evolution-edit-crypto';

// protobuf mínimo para montar o que o celular manda
const varint = (n: number) => { const o: number[] = []; while (n > 127) { o.push((n & 127) | 128); n >>>= 7; } o.push(n); return Buffer.from(o); };
const ld = (f: number, b: Buffer | string) => { const v = Buffer.isBuffer(b) ? b : Buffer.from(b); return Buffer.concat([varint((f << 3) | 2), varint(v.length), v]); };
const vi = (f: number, n: number) => Buffer.concat([varint(f << 3), varint(n)]);

const CONTATO = '279426361217273@lid';
const ALVO = 'ACFE3612AFA3CE19F730FDE3CF971006';

function cifrar(secret: Buffer, autor: string, editor: string, plano: Buffer) {
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), Buffer.from(ALVO + autor + editor + 'Message Edit'), 32));
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  return { encPayload: Buffer.concat([c.update(plano), c.final(), c.getAuthTag()]).toString('base64'), encIv: iv.toString('base64') };
}
const edicao = (texto: Buffer, alvo = ALVO) => ld(12, Buffer.concat([ld(1, Buffer.concat([ld(1, CONTATO), vi(2, 1), ld(3, alvo)])), vi(2, 14), ld(14, texto), vi(15, 1793713698000)]));
// o webhook serializa Uint8Array como { "0": .., "1": .. }
const comoObjeto = (b: Buffer) => Object.fromEntries([...b].map((x, i) => [String(i), x]));

describe('edição cifrada (secretEncryptedMessage, formato novo do WhatsApp)', () => {
  const secret = randomBytes(32);
  const raw = { key: { remoteJid: CONTATO, remoteJidAlt: '5517991952527@s.whatsapp.net', fromMe: false, id: ALVO }, message: { conversation: 'antes', messageContextInfo: { messageSecret: comoObjeto(secret) } } };

  it('provider entrega a edição cifrada e ela decifra com o segredo da original', () => {
    const sem = { ...cifrar(secret, CONTATO, CONTATO, edicao(ld(1, 'depois'))), secretEncType: 2, targetMessageKey: { id: ALVO, fromMe: true, remoteJid: '44667676700852@lid' } };
    const out = new EvolutionProvider().parseWebhook({ event: 'messages.upsert', instance: 'i1', data: { key: { remoteJid: CONTATO, remoteJidAlt: '5517991952527@s.whatsapp.net', fromMe: false, id: 'EVT1' }, messageTimestamp: 1793713698, message: { messageContextInfo: {}, secretEncryptedMessage: sem } } });
    expect(out.messages).toHaveLength(0);
    const e = out.edits![0];
    expect(e).toMatchObject({ targetExternalId: ALVO });
    expect(e.text).toBeUndefined();
    expect(decifrarEdicao(segredoDaOriginal(raw)!, ALVO, e.encrypted!, jidsDaOriginal(raw))).toBe('depois');
  });

  it('acha o autor certo entre lid e telefone; texto estendido também', () => {
    const pn = '5517991952527@s.whatsapp.net';
    const sem = cifrar(secret, pn, pn, edicao(ld(6, ld(1, 'corrigido'))));
    expect(decifrarEdicao(secret, ALVO, { payload: sem.encPayload, iv: sem.encIv, jids: [CONTATO] }, jidsDaOriginal(raw))).toBe('corrigido');
  });

  it('segredo errado ou edição apontando outra mensagem: não aplica', () => {
    const sem = cifrar(secret, CONTATO, CONTATO, edicao(ld(1, 'x')));
    expect(decifrarEdicao(randomBytes(32), ALVO, { payload: sem.encPayload, iv: sem.encIv, jids: [CONTATO] })).toBeNull();
    const outra = cifrar(secret, CONTATO, CONTATO, edicao(ld(1, 'x'), 'OUTRA'));
    expect(decifrarEdicao(secret, ALVO, { payload: outra.encPayload, iv: outra.encIv, jids: [CONTATO] })).toBeNull();
  });

  it('webhook da Evolution troca o @lid pelo telefone: sem o lid não decifra, com o lid buscado sim', () => {
    const pn = '5517991952527@s.whatsapp.net';
    const sem = { ...cifrar(secret, CONTATO, CONTATO, edicao(ld(1, 'depois'))), secretEncType: 2, targetMessageKey: { id: ALVO } };
    // como chega no webhook: remoteJid já trocado pelo telefone
    const c = lerEdicaoCifrada({ secretEncryptedMessage: sem }, { id: 'EVT2', remoteJid: pn, remoteJidAlt: pn, addressingMode: 'lid' })!;
    expect(c.encrypted.eventId).toBe('EVT2');
    expect(precisaDoLid(c.encrypted)).toBe(true);
    const rawPn = { key: { remoteJid: pn, remoteJidAlt: pn } };
    expect(decifrarEdicao(secret, ALVO, c.encrypted, jidsDaOriginal(rawPn))).toBeNull();
    expect(decifrarEdicao(secret, ALVO, { ...c.encrypted, jids: [...c.encrypted.jids, CONTATO] }, jidsDaOriginal(rawPn))).toBe('depois');
  });

  it('bytes em base64, objeto numerado e Buffer JSON', () => {
    const b = Buffer.from([1, 2, 3]);
    expect(bytesDe(b.toString('base64'))).toEqual(b);
    expect(bytesDe(comoObjeto(b))).toEqual(b);
    expect(bytesDe({ type: 'Buffer', data: [1, 2, 3] })).toEqual(b);
    expect(bytesDe({})).toBeNull();
  });
});
