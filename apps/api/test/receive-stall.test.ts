import { describe, expect, it } from 'vitest';
import { SILENCE_MS, isReceiveStalled, isSilentTooLong } from '../src/modules/whatsapp/receive-stall';

describe('número que envia mas não recebe', () => {
  it('caso real Drog. Kelly I: 4 sem confirmação para 2 contatos', () => {
    expect(isReceiveStalled({ unacked: 4, conversations: 2 })).toBe(true);
  });
  it('um contato só com o celular desligado não marca', () => {
    expect(isReceiveStalled({ unacked: 10, conversations: 1 })).toBe(false);
  });
  it('poucas mensagens ainda não marcam', () => {
    expect(isReceiveStalled({ unacked: 2, conversations: 2 })).toBe(false);
  });
});

describe('silêncio anormal', () => {
  it('caso real Drog. Kelly I 17/10: 1 h sem sinal num horário que costuma ter movimento', () => {
    expect(isSilentTooLong({ silentMs: SILENCE_MS, expected: 12 })).toBe(true);
  });
  it('mesmo horário da semana passada sem movimento (noite, domingo) não marca', () => {
    expect(isSilentTooLong({ silentMs: 5 * SILENCE_MS, expected: 2 })).toBe(false);
  });
  it('menos de 1 h de silêncio ainda não marca', () => {
    expect(isSilentTooLong({ silentMs: SILENCE_MS - 1, expected: 30 })).toBe(false);
  });
  it('sem sinal recente conhecido não marca (fica com a outra regra)', () => {
    expect(isSilentTooLong({ silentMs: null, expected: 30 })).toBe(false);
  });
});
