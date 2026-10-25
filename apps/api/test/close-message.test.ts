import { describe, expect, it } from 'vitest';
import { buildCloseMessage, DEFAULT_CLOSE_TEXT } from '../src/modules/conversations/close-message';

describe('buildCloseMessage', () => {
  it('o padrão sai sem precisar de atendente', () => {
    expect(buildCloseMessage(DEFAULT_CLOSE_TEXT, null)).toBe(DEFAULT_CLOSE_TEXT);
  });
  it('{{atendente}} vira o primeiro nome de quem atendeu', () => {
    expect(buildCloseMessage('Obrigado! {{atendente}} encerrou seu atendimento.', 'Maria Silva')).toBe('Obrigado! Maria encerrou seu atendimento.');
  });
  it('atendente sem nome ou texto vazio: não manda nada', () => {
    expect(buildCloseMessage('{{atendente}} encerrou', null)).toBeNull();
    expect(buildCloseMessage('   ', 'Ana')).toBeNull();
  });
});
