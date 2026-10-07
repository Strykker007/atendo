import { describe, expect, it } from 'vitest';
import { spin } from '../src/modules/conversations/spin';

describe('variações de texto', () => {
  it('sorteia uma das opções', () => expect(spin('{Oi|Olá}, tudo bem?', () => 0.99)).toBe('Olá, tudo bem?'));
  it('primeira opção', () => expect(spin('{Oi|Olá}!', () => 0)).toBe('Oi!'));
  it('várias no mesmo texto', () => expect(spin('{a|b} e {c|d}', () => 0)).toBe('a e c'));
  it('opção vazia vale', () => expect(spin('Oi{|!}', () => 0)).toBe('Oi'));
  it('variável {{nome}} fica intacta', () => expect(spin('Oi {{nome}}', () => 0)).toBe('Oi {{nome}}'));
  it('{{a|b}} não é variação', () => expect(spin('x {{a|b}}', () => 0)).toBe('x {{a|b}}'));
  it('chave sem barra fica intacta', () => expect(spin('código {123}', () => 0)).toBe('código {123}'));
  it('texto comum não muda', () => expect(spin('Bom dia, tudo bem?')).toBe('Bom dia, tudo bem?'));
});
