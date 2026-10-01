import { describe, expect, it } from 'vitest';
import { canUseNumber, narrowTo, numberFilter, unrestricted, type Scoped } from '../src/modules/auth/number-scope';

const u = (numberIds?: string[], role = 'agent'): Scoped => ({ role, numberIds });

describe('lista vazia = todos os números', () => {
  // esta é A regra: se vazio significasse "nenhum", ligar a funcionalidade trancaria a
  // equipe inteira para fora do atendimento no primeiro deploy
  it.each([[undefined], [[]]])('sem vínculo opera tudo (%s)', (ids) => {
    expect(unrestricted(u(ids))).toBe(true);
    expect(canUseNumber(u(ids), 'qualquer')).toBe(true);
    expect(numberFilter(u(ids))).toBeUndefined();
  });

  it('o dono do sistema nunca é restringido — ele dá suporte entrando como o cliente', () => {
    expect(unrestricted(u(['n1'], 'super_admin'))).toBe(true);
    expect(canUseNumber(u(['n1'], 'super_admin'), 'n9')).toBe(true);
  });
});

describe('com restrição', () => {
  it('só os números vinculados', () => {
    expect(canUseNumber(u(['n1', 'n2']), 'n1')).toBe(true);
    expect(canUseNumber(u(['n1', 'n2']), 'n3')).toBe(false);
  });

  it('conversa sem número não passa por quem está restrito', () => {
    expect(canUseNumber(u(['n1']), null)).toBe(false);
    expect(canUseNumber(u(['n1']), undefined)).toBe(false);
    // ...mas passa por quem não tem restrição, senão quebraria o caso comum
    expect(canUseNumber(u([]), null)).toBe(true);
  });

  it('o filtro do Prisma lista exatamente os vinculados', () => {
    expect(numberFilter(u(['n1', 'n2']))).toEqual({ in: ['n1', 'n2'] });
  });
});

describe('narrowTo', () => {
  it('sem pedido, devolve o escopo do usuário', () => {
    expect(narrowTo(u(['n1']))).toEqual({ in: ['n1'] });
    expect(narrowTo(u([]))).toBeUndefined();
  });

  it('pedido permitido passa direto', () => {
    expect(narrowTo(u(['n1', 'n2']), 'n2')).toBe('n2');
    expect(narrowTo(u([]), 'n9')).toBe('n9');
  });

  it('pedido proibido vira null — nunca "sem filtro"', () => {
    // devolver undefined aqui mostraria justamente os números que a pessoa não pode ver
    expect(narrowTo(u(['n1']), 'n3')).toBeNull();
  });
});
