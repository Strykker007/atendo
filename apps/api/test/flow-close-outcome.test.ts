import { describe, expect, it } from 'vitest';
// direto da fonte: a função é nova e o `dist` do shared só atualiza no build
import { parseMoneyText } from '../../../packages/shared/src/flows';
import { parseTemplateContent, templateTagConflictPairs } from '../src/modules/tenants/tenant-template';

describe('valor da venda no "Encerrar conversa" do fluxo (parseMoneyText)', () => {
  it.each([
    ['R$ 1.234,56', 1234.56],
    ['1234,5', 1234.5],
    ['1234.56', 1234.56],
    ['1.500', 1500],
    ['1.234.567', 1234567],
    ['  89,9 ', 89.9],
  ])('%s → %s', (txt, v) => expect(parseMoneyText(txt)).toBe(v));

  it.each(['', 'abc', '0', '0,00', '-10', '1,2,3', '{{valor}}'])('inválido: "%s"', (txt) => expect(parseMoneyText(txt)).toBeNull());
});

describe('"Conflita com" nas tags do modelo', () => {
  it('guarda só nomes da lista, sem ela mesma e sem repetir; ajusta maiúsculas', () => {
    const c = parseTemplateContent({ tags: [
      { name: 'Lead', conflictsWith: ['cliente', 'Cliente', 'Lead', 'Fantasma'] },
      { name: 'Cliente' },
    ] });
    expect(c.tags?.[0].conflictsWith).toEqual(['Cliente']);
    expect(c.tags?.[1].conflictsWith).toBeUndefined();
  });

  it('par simétrico vira uma linha só', () => {
    const c = parseTemplateContent({ tags: [{ name: 'A', conflictsWith: ['B'] }, { name: 'B', conflictsWith: ['A'] }] });
    expect(templateTagConflictPairs(c.tags!)).toEqual([['a', 'b']]);
  });

  it('recusa tag com mais de 20 opostas (contando os dois lados)', () => {
    const outras = Array.from({ length: 21 }, (_, i) => ({ name: `T${i}`, conflictsWith: ['Hub'] }));
    expect(() => parseTemplateContent({ tags: [{ name: 'Hub' }, ...outras] })).toThrow(/mais de 20/);
  });

  it('formato não-lista é recusado', () => {
    expect(() => parseTemplateContent({ tags: [{ name: 'A', conflictsWith: 'B' }] })).toThrow(/lista/);
  });
});
