import { describe, expect, it } from 'vitest';
import { TICKET_TYPE_PRESETS, checkTicketValues, cleanTicketFields, ticketFieldKey } from '@atendo/shared';

describe('cleanTicketFields', () => {
  it('gera chave sem acento a partir do rótulo e mantém a chave existente', () => {
    expect(ticketFieldKey('Nº do apartamento')).toBe('n_do_apartamento');
    const f = cleanTicketFields([{ label: 'Unidade' }, { key: 'bloco', label: 'Bloco / torre' }]);
    expect(f.map((x) => x.key)).toEqual(['unidade', 'bloco']);
  });
  it('chave repetida ganha sufixo; sem rótulo some; select sem opção some', () => {
    const f = cleanTicketFields([{ label: 'Área' }, { label: 'area' }, { label: '' }, { label: 'Tipo', type: 'select', options: [' ', ''] }]);
    expect(f.map((x) => x.key)).toEqual(['area', 'area_2']);
  });
  it('tipo desconhecido vira texto; opções sem repetição', () => {
    const [a, b] = cleanTicketFields([{ label: 'X', type: 'html' }, { label: 'Y', type: 'select', options: ['A', 'A', ' B '] }]);
    expect(a.type).toBe('text');
    expect(b.options).toEqual(['A', 'B']);
  });
});

describe('checkTicketValues', () => {
  const fields = cleanTicketFields([
    { label: 'Unidade', required: true },
    { label: 'Área', type: 'select', options: ['Salão de festas', 'Quadra'] },
    { label: 'Quantidade', type: 'number' },
    { label: 'Data', type: 'date' },
  ]);
  it('obrigatório vazio aparece em missing', () => {
    expect(checkTicketValues(fields, {}).missing).toEqual(['Unidade']);
  });
  it('select aceita sem acento/maiúscula e grava a opção cadastrada', () => {
    const r = checkTicketValues(fields, { unidade: '302', area: 'salao de FESTAS' });
    expect(r.values).toEqual({ unidade: '302', area: 'Salão de festas' });
    expect(r.invalid).toEqual([]);
  });
  it('fora da lista: guarda o texto e avisa', () => {
    const r = checkTicketValues(fields, { unidade: '1', area: 'Piscina' });
    expect(r.values.area).toBe('Piscina');
    expect(r.invalid).toEqual(['Área']);
  });
  it('número e data conferidos; campo desconhecido descartado', () => {
    const r = checkTicketValues(fields, { unidade: '1', quantidade: 'duas', data: '12/11', extra: 'x' });
    expect(r.invalid).toEqual(['Quantidade']);
    expect(r.values).not.toHaveProperty('extra');
  });
});

describe('modelos por nicho', () => {
  it('todos os modelos passam pela própria limpeza sem perder campo', () => {
    for (const p of TICKET_TYPE_PRESETS) for (const t of p.types) expect(cleanTicketFields(t.fields)).toHaveLength(t.fields.length);
  });
});
