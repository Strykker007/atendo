import { describe, expect, it } from 'vitest';
import { lerCitacao } from '../src/modules/whatsapp/providers/quoted';

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
    expect(c).toEqual({ externalId: 'ST1', preview: '📷 Foto: Promoção: 20% em toda a loja', fromStatus: true });
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
