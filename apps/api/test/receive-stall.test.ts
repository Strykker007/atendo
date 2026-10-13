import { describe, expect, it } from 'vitest';
import { isReceiveStalled } from '../src/modules/whatsapp/receive-stall';

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
