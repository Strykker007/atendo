import { describe, expect, it } from 'vitest';
import { signText } from '../src/modules/conversations/conversations.service';

describe('signText (assinatura obrigatória)', () => {
  it('assina o texto sem assinatura', () => {
    expect(signText('Bom dia!', 'Ana')).toBe('*Ana:*\nBom dia!');
  });
  it('texto já assinado (pela tela) fica como está', () => {
    expect(signText('*Ana:*\nBom dia!', 'Ana')).toBe('*Ana:*\nBom dia!');
  });
});
