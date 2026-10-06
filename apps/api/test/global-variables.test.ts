import { describe, expect, it } from 'vitest';
import { globalVarKey, globalVarKeyError } from '@atendo/shared';
import { interpolate, type InterpolateCtx } from '../src/modules/flows/answer';

// como o InterpolationService monta: `global.<key>` sempre, `<key>` sem colisão
const ctx: InterpolateCtx = {
  contact: { name: 'Tiago', phone: '5562999999999' },
  vars: { horario: 'do fluxo' },
  globals: { empresa: 'Loja X', 'global.pix_chave': 'pix@loja.com', pix_chave: 'pix@loja.com', 'global.horario': '', horario: '' },
};

describe('variáveis da empresa', () => {
  it('com e sem o prefixo global., com filtros e padrão', () => {
    expect(interpolate('{{pix_chave}}|{{global.pix_chave}}', ctx)).toBe('pix@loja.com|pix@loja.com');
    expect(interpolate('{{global.pix_chave | upper}}', ctx)).toBe('PIX@LOJA.COM');
    expect(interpolate("{{global.horario | default: '08h às 18h'}}", ctx)).toBe('08h às 18h');
  });

  it('variável do fluxo vence a da empresa sem prefixo; com prefixo vale a da empresa', () => {
    expect(interpolate('{{horario}}', ctx)).toBe('do fluxo');
    expect(interpolate("{{global.horario || 'fechado'}}", ctx)).toBe('fechado');
  });

  it('chave gerada do rótulo e validação', () => {
    expect(globalVarKey('Chave PIX da Loja')).toBe('chave_pix_da_loja');
    expect(globalVarKey('Horário de atendimento!')).toBe('horario_de_atendimento');
    expect(globalVarKeyError('pix_chave')).toBeNull();
    expect(globalVarKeyError('empresa')).toMatch(/sistema/);
    expect(globalVarKeyError('1pix')).not.toBeNull();
    expect(globalVarKeyError('Pix')).not.toBeNull();
  });
});
