import { describe, expect, it } from 'vitest';
import { tipoDaTransicao } from '../src/modules/conversations/conversations.service';

describe('tipoDaTransicao', () => {
  it('encerrar é sempre "closed", de onde quer que venha', () => {
    expect(tipoDaTransicao('waiting', 'closed')).toBe('closed');
    expect(tipoDaTransicao('in_progress', 'closed')).toBe('closed');
  });

  it('sair de encerrado é reabertura — e não um novo encerramento', () => {
    expect(tipoDaTransicao('closed', 'in_progress')).toBe('reopened');
    expect(tipoDaTransicao('closed', 'waiting')).toBe('reopened');
  });

  it('assumir e devolver, fora de encerramento', () => {
    expect(tipoDaTransicao('waiting', 'in_progress')).toBe('claimed');
    expect(tipoDaTransicao('in_progress', 'waiting')).toBe('released');
  });

  it('sem estado anterior (conversa recém-criada) não vira reabertura', () => {
    expect(tipoDaTransicao(null, 'in_progress')).toBe('claimed');
    expect(tipoDaTransicao(undefined, 'waiting')).toBe('released');
  });
});
