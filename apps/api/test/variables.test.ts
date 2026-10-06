import { describe, expect, it } from 'vitest';
import { attributeVarKey, firstName, greetingAt, greetingForHour } from '@atendo/shared';
import { interpolate, type InterpolateCtx } from '../src/modules/flows/answer';

const ctx: InterpolateCtx = {
  contact: { name: 'Maria Clara Souza', phone: '5500000000000', attributes: { placa_do_carro: 'ABC1D23', cpf: '000' } },
  vars: { empresa: 'Do fluxo' },
  globals: { empresa: 'Barbearia X', 'company.name': 'Barbearia X', saudacao: 'Boa tarde', greeting: 'Boa tarde' },
};

describe('variáveis', () => {
  it('saudação pelas faixas pedidas', () => {
    expect(greetingForHour(5)).toBe('Bom dia');
    expect(greetingForHour(11)).toBe('Bom dia');
    expect(greetingForHour(12)).toBe('Boa tarde');
    expect(greetingForHour(17)).toBe('Boa tarde');
    expect(greetingForHour(18)).toBe('Boa noite');
    expect(greetingForHour(4)).toBe('Boa noite');
  });

  it('saudação no fuso do cliente, não do servidor', () => {
    // 14:00 UTC = 11:00 em São Paulo
    expect(greetingAt(new Date('2026-10-06T14:00:00Z'), 'America/Sao_Paulo')).toBe('Bom dia');
  });

  it('chave de campo livre sem acento e com _', () => {
    expect(attributeVarKey('Placa do carro')).toBe('placa_do_carro');
    expect(attributeVarKey(' Endereço de Cobrança ')).toBe('endereco_de_cobranca');
    expect(attributeVarKey('C.P.F.')).toBe('c_p_f');
  });

  it('primeiro nome', () => {
    expect(firstName('  Maria Clara ')).toBe('Maria');
    expect(firstName(null)).toBe('');
  });

  it('resolve contato, campo livre, globais e aliases', () => {
    expect(interpolate('{{saudacao}}, {{contact.first_name}}! Placa {{contact.placa_do_carro}} — {{company.name}} {{greeting}}', ctx))
      .toBe('Boa tarde, Maria! Placa ABC1D23 — Barbearia X Boa tarde');
  });

  it('variável do fluxo vence a global de mesmo nome', () => {
    expect(interpolate('{{empresa}}', ctx)).toBe('Do fluxo');
  });

  it('campo livre que o contato não tem vira vazio', () => {
    expect(interpolate('[{{contact.rg}}]', ctx)).toBe('[]');
  });

  it('keepUnknown (chat) deixa chave desconhecida como foi escrita', () => {
    expect(interpolate('{{x}} {{saudacao}}', { ...ctx, vars: {} }, undefined, { keepUnknown: true })).toBe('{{x}} Boa tarde');
  });
});
