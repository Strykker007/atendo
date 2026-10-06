import { describe, expect, it } from 'vitest';
import { formatPhone, lastName, parseVariableExpr, titleCase } from '@atendo/shared';
import { interpolate, jsonEscape, type InterpolateCtx } from '../src/modules/flows/answer';

const ctx = (name: string | null, phone = '5562999999999'): InterpolateCtx => ({
  contact: { name, phone, attributes: { placa_do_carro: 'abc1d23' } },
  vars: { cidade: 'goiânia' },
  globals: { empresa: 'Barbearia X', 'company.name': 'Barbearia X', saudacao: 'Boa tarde', greeting: 'Boa tarde' },
});
const tiago = ctx('Tiago Lima de Melo');

describe('interpolação — filtros e valor padrão', () => {
  it('primeiro e último nome (variável derivada e filtro)', () => {
    expect(interpolate('{{contact.first_name}}|{{contact.name | first}}', tiago)).toBe('Tiago|Tiago');
    expect(interpolate('{{contact.last_name}}|{{contact.name | last}}', tiago)).toBe('Melo|Melo');
    expect(interpolate('{{contact.last_name}}', ctx('Tiago'))).toBe('Tiago');
  });

  it('title / upper / lower', () => {
    expect(interpolate('{{contact.name | title}}', ctx('TIAGO LIMA DE MELO'))).toBe('Tiago Lima de Melo');
    expect(interpolate('{{contact.name | first | upper}}', tiago)).toBe('TIAGO');
    expect(interpolate('{{contact.name|lower}}', tiago)).toBe('tiago lima de melo');
    expect(interpolate('{{ cidade | upper }}', tiago)).toBe('GOIÂNIA');
    expect(interpolate('{{contact.placa_do_carro | upper}}', tiago)).toBe('ABC1D23');
  });

  it('telefone formatado', () => {
    expect(interpolate('{{contact.phone}}', tiago)).toBe('5562999999999');
    expect(interpolate('{{contact.phone | formatted}}', tiago)).toBe('(62) 99999-9999');
    expect(formatPhone('556233334444')).toBe('(62) 3333-4444');
    expect(formatPhone('62999999999')).toBe('(62) 99999-9999');
    expect(formatPhone('15551234567')).toBe('+15551234567'); // EUA não vira DDD 15
    expect(formatPhone('351912345678')).toBe('+351912345678');
    expect(formatPhone('não informado')).toBe('não informado');
  });

  it('valor padrão: | default e ||, com aspas ou sem', () => {
    const anon = ctx(null);
    expect(interpolate("Olá, {{contact.name | default: 'Cliente'}}!", anon)).toBe('Olá, Cliente!');
    expect(interpolate("Olá, {{contact.first_name || 'Cliente'}}!", anon)).toBe('Olá, Cliente!');
    expect(interpolate('Olá, {{contact.first_name || "Cliente querido"}}!', anon)).toBe('Olá, Cliente querido!');
    expect(interpolate('Olá, {{contact.first_name || Cliente}}!', anon)).toBe('Olá, Cliente!');
    expect(interpolate('Olá, {{contact.first_name || ‘Cliente’}}!', anon)).toBe('Olá, Cliente!');
    expect(interpolate("{{contact.name | default: 'x'}}", ctx('   '))).toBe('x');
    // tem nome: o padrão não entra
    expect(interpolate("{{contact.first_name || 'Cliente'}}", tiago)).toBe('Tiago');
  });

  it('ordem importa: filtro depois do padrão também formata o padrão', () => {
    expect(interpolate("{{contact.first_name || 'cliente' | upper}}", ctx(null))).toBe('CLIENTE');
    expect(interpolate("{{contact.first_name | upper || 'cliente'}}", ctx(null))).toBe('cliente');
  });

  it('chave desconhecida: vazio, padrão se houver; no chat fica como foi escrita', () => {
    expect(interpolate('[{{nada | upper}}]', tiago)).toBe('[]');
    expect(interpolate("[{{nada || 'x'}}]", tiago)).toBe('[x]');
    expect(interpolate('{{nada | upper}}', tiago, undefined, { keepUnknown: true })).toBe('{{nada | upper}}');
    expect(interpolate("{{nada || 'x'}}", tiago, undefined, { keepUnknown: true })).toBe('x');
  });

  it('filtro desconhecido é ignorado; sintaxe inválida fica como foi escrita', () => {
    expect(interpolate('{{contact.first_name | piscar}}', tiago)).toBe('Tiago');
    expect(interpolate("{{contact.name | default: 'sem fim}}", tiago)).toBe("{{contact.name | default: 'sem fim}}");
    expect(interpolate('{{ olá mundo }}', tiago)).toBe('{{ olá mundo }}');
    expect(interpolate('{{}}', tiago)).toBe('{{}}');
  });

  it('globais e aliases continuam iguais', () => {
    expect(interpolate('{{greeting}}, {{contact.first_name}}! — {{company.name | upper}}', tiago)).toBe('Boa tarde, Tiago! — BARBEARIA X');
  });

  it('escape vale também para o valor padrão (corpo JSON do webhook)', () => {
    expect(interpolate('{"n":"{{contact.name || \'A "B"\'}}"}', ctx(null), jsonEscape)).toBe('{"n":"A \\"B\\""}');
  });
});

describe('helpers', () => {
  it('parseVariableExpr', () => {
    expect(parseVariableExpr(" contact.name | first | default: 'Cliente' ")).toEqual({
      key: 'contact.name',
      filters: [{ name: 'first' }, { name: 'default', arg: 'Cliente' }],
    });
    expect(parseVariableExpr("contact.name || 'X'")).toEqual({ key: 'contact.name', filters: [{ name: 'default', arg: 'X' }] });
    expect(parseVariableExpr('contact.name |')).toBeNull();
  });

  it('lastName / titleCase', () => {
    expect(lastName('  ')).toBe('');
    expect(lastName(null)).toBe('');
    expect(titleCase('ANA-MARIA DOS SANTOS')).toBe('Ana-Maria dos Santos');
    expect(titleCase('de souza')).toBe('De Souza');
  });
});
