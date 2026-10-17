import { describe, expect, it } from 'vitest';
import { mapHeader, mergeContact, parseCsv, readImportRows, toCsv, EXPORT_HEADER } from '../src/modules/contacts/contacts-io';

describe('parseCsv', () => {
  it('detecta ; do Excel em português, tira o BOM e ignora linhas vazias', () => {
    expect(parseCsv('﻿Nome;Telefone\r\nAna;(11) 99999-8888\r\n\r\nBia;11988887777\r\n')).toEqual([['Nome', 'Telefone'], ['Ana', '(11) 99999-8888'], ['Bia', '11988887777']]);
  });
  it('aceita vírgula, aspas com separador, aspas escapadas e quebra de linha', () => {
    expect(parseCsv('nome,phone\n"Silva, Ana","11 99999-8888"\n"Diz ""oi""\nnova",1')).toEqual([['nome', 'phone'], ['Silva, Ana', '11 99999-8888'], ['Diz "oi"\nnova', '1']]);
  });
  it('tabulação', () => {
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('toCsv', () => {
  it('BOM, ; e escape; fórmula vira texto, telefone com + não', () => {
    const csv = toCsv([['a;b', 'x"y', '=HYPERLINK("x")', '+55 11 9999-8888', null]]);
    expect(csv).toBe('﻿"a;b";"x""y";"\'=HYPERLINK(""x"")";+55 11 9999-8888;\r\n');
  });
  it('exportação reimporta: o cabeçalho é reconhecido', () => {
    const m = mapHeader(EXPORT_HEADER)!;
    expect(m).toMatchObject({ name: 0, phone: 1, email: 2, document: 3, address: 4, note1: 5, note2: 6, tags: 7 });
  });
});

describe('readImportRows', () => {
  it('normaliza telefone, separa inválidos e repetidos, lê tags e descarta e-mail ruim', () => {
    const r = readImportRows([
      ['Nome', 'Celular', 'E-mail', 'CPF', 'Etiquetas'],
      ['Ana', '(11) 99999-8888', 'ANA@X.COM', '123.456.789-09', 'VIP, Recorrente'],
      ['Bia', '123', '', '', ''],
      ['Ana de novo', '5511999998888', '', '', ''],
      ['Caio', '', 'caio@', '12', ''],
    ]);
    expect(r.records).toEqual([{ line: 2, phone: '5511999998888', name: 'Ana', email: 'ana@x.com', document: '12345678909', address: undefined, note1: undefined, note2: undefined, tags: ['VIP', 'Recorrente'] }]);
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toEqual([{ line: 3, value: '123', reason: 'telefone inválido' }, { line: 5, value: '', reason: 'sem telefone' }]);
  });
  it('sem cabeçalho: acha a coluna de telefone e a de nome', () => {
    const r = readImportRows([['Ana', '11999998888'], ['Bia', '11988887777']]);
    expect(r.records.map((x) => [x.name, x.phone, x.line])).toEqual([['Ana', '5511999998888', 1], ['Bia', '5511988887777', 2]]);
  });
});

describe('mergeContact', () => {
  const cur = { name: 'Ana Maria', nameSource: 'manual' as const, email: null, document: '1', address: null, note1: null, note2: null };
  const rec = { line: 2, phone: '5511999998888', name: 'Ana', email: 'a@x.com', document: '12345678909', tags: [] };
  it('sem sobrescrever: preserva nome manual e campos preenchidos, completa os vazios', () => {
    expect(mergeContact(cur, rec, false)).toEqual({ email: 'a@x.com' });
  });
  it('nome do WhatsApp dá lugar ao da planilha', () => {
    expect(mergeContact({ ...cur, nameSource: 'whatsapp' }, rec, false)).toEqual({ name: 'Ana', nameSource: 'manual', email: 'a@x.com' });
  });
  it('sobrescrever: a planilha vence', () => {
    expect(mergeContact(cur, rec, true)).toEqual({ name: 'Ana', nameSource: 'manual', email: 'a@x.com', document: '12345678909' });
  });
});
