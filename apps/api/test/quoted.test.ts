import { describe, expect, it } from 'vitest';
import { bytesEmBase64, lerCitacao } from '../src/modules/whatsapp/providers/quoted';

describe('lerCitacao', () => {
  it('mensagem comum, sem citação', () => {
    expect(lerCitacao({ conversation: 'oi' })).toBeUndefined();
  });

  it('resposta a uma mensagem da conversa', () => {
    const c = lerCitacao({ extendedTextMessage: { text: 'pode ser', contextInfo: { stanzaId: 'ABC123', quotedMessage: { conversation: 'confirma o horário?' } } } });
    expect(c).toEqual({ externalId: 'ABC123', preview: 'confirma o horário?', fromStatus: false });
  });

  it('resposta a status guarda o conteúdo do story — ele some em 24h', () => {
    const c = lerCitacao({
      extendedTextMessage: {
        text: 'quero esse',
        contextInfo: { remoteJid: 'status@broadcast', stanzaId: 'ST1', quotedMessage: { imageMessage: { caption: 'Promoção: 20% em toda a loja' } } },
      },
    });
    expect(c).toMatchObject({ externalId: 'ST1', preview: '📷 Foto: Promoção: 20% em toda a loja', fromStatus: true, media: { kind: 'image' } });
  });

  it('resposta a status em texto puro: o contexto vem fora de `message` (payload real da Evolution)', () => {
    const thumb = { 0: 255, 1: 216, 2: 255, 3: 224 };
    const c = lerCitacao({ conversation: 'Quero' }, {
      stanzaId: '2A62482F3871E2CD9478',
      remoteJid: 'status@broadcast',
      participant: '12013627551880@lid',
      quotedMessage: { conversation: '', imageMessage: { caption: '', mimetype: 'image/jpeg', mediaKey: { 0: 30, 1: 122 }, jpegThumbnail: thumb } },
    });
    expect(c).toEqual({
      externalId: '2A62482F3871E2CD9478',
      preview: '📷 Foto',
      fromStatus: true,
      media: { kind: 'image', mimeType: 'image/jpeg', thumbnail: Buffer.from([255, 216, 255, 224]).toString('base64') },
    });
  });

  it('contexto do topo sem citação (mensagem comum da Evolution) não vira citação', () => {
    expect(lerCitacao({ conversation: 'oi' }, { mentionedJid: [], statusAttributions: [] })).toBeUndefined();
  });

  it('bytes do quotedMessage voltam em base64 para a Evolution baixar a mídia', () => {
    expect(bytesEmBase64({ imageMessage: { mediaKey: { 0: 30, 1: 122 }, url: 'u', scanLengths: [1, 2] } }))
      .toEqual({ imageMessage: { mediaKey: Buffer.from([30, 122]).toString('base64'), url: 'u', scanLengths: [1, 2] } });
  });

  it('status sem legenda ainda diz o que era', () => {
    const c = lerCitacao({ extendedTextMessage: { contextInfo: { remoteJid: 'status@broadcast', quotedMessage: { videoMessage: {} } } } });
    expect(c?.preview).toBe('🎥 Vídeo');
    expect(c?.fromStatus).toBe(true);
  });

  it('o contexto vem pendurado no tipo da resposta, não só em texto', () => {
    const c = lerCitacao({ imageMessage: { caption: 'olha', contextInfo: { stanzaId: 'X9', quotedMessage: { conversation: 'manda foto' } } } });
    expect(c?.externalId).toBe('X9');
    expect(c?.preview).toBe('manda foto');
  });

  it('citação de áudio vira rótulo, não citação vazia', () => {
    const c = lerCitacao({ extendedTextMessage: { contextInfo: { stanzaId: 'A1', quotedMessage: { audioMessage: { seconds: 7 } } } } });
    expect(c?.preview).toBe('🎤 Áudio');
  });

  it('contexto sem nada aproveitável não vira citação', () => {
    expect(lerCitacao({ extendedTextMessage: { contextInfo: { mentionedJid: [] } } })).toBeUndefined();
  });
});
