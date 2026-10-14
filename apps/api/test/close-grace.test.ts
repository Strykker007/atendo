import { describe, expect, it } from 'vitest';
import { ehConfirmacao, naCarencia, CLOSE_GRACE_MS } from '../src/modules/conversations/reopen';

const t = (text: string) => ({ type: 'text', text });

describe('ehConfirmacao (não reabre na carência)', () => {
  it.each(['ok', 'Ok.', 'obrigada', 'Obrigada 😊', 'ok obrigada', 'Ok, obrigado!', 'certo', 'blz', 'tá bom', 'Ta bom', 'por nada', 'Eu que agradeço', 'muito obrigado 🫂', 'obgd', 'Valeu!!', 'ah, certo, obrigada! 😊'.replace('ah, ', ''), '👍', '🙏🏼'])('"%s" é confirmação', (txt) => {
    expect(ehConfirmacao(t(txt))).toBe(true);
  });
  it.each(['oi', 'bom dia', 'sim', 'não', 'quanto tempo pra entrega', 'ok, e a entrega?', 'na farmácia vizinha tá de 19', 'obrigada, mas ainda não chegou', '1', 'quantos minutos'])('"%s" reabre', (txt) => {
    expect(ehConfirmacao(t(txt))).toBe(false);
  });
  it('figurinha confirma; áudio e foto reabrem', () => {
    expect(ehConfirmacao({ type: 'sticker' })).toBe(true);
    expect(ehConfirmacao({ type: 'audio' })).toBe(false);
    expect(ehConfirmacao({ type: 'image' })).toBe(false);
  });
});

describe('naCarencia', () => {
  const fechou = new Date('2026-10-13T12:00:00Z');
  it('dentro das 2 h', () => {
    expect(naCarencia(fechou, new Date(fechou.getTime() + 60_000))).toBe(true);
  });
  it('depois das 2 h reabre', () => {
    expect(naCarencia(fechou, new Date(fechou.getTime() + CLOSE_GRACE_MS))).toBe(false);
  });
  it('mensagem com horário do WhatsApp um pouco antes do encerramento (relógio) ainda conta', () => {
    expect(naCarencia(fechou, new Date(fechou.getTime() - 2_000))).toBe(true);
  });
  it('sem data de encerramento não há carência', () => {
    expect(naCarencia(null, fechou)).toBe(false);
  });
});
