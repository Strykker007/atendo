import { describe, expect, it, vi, beforeEach } from 'vitest';

// o `dist` do shared só atualiza no build: o teste usa a fonte
vi.mock('@atendo/shared', () => import('../../../packages/shared/src/index'));
const call = vi.fn();
vi.mock('../src/modules/flows/webhook', () => ({ callWebhook: (...a: unknown[]) => call(...a) }));

import { listJsonPaths, parseJsonPath, readJsonPath, suggestVarName, jsonValueText } from '../../../packages/shared/src/json-path';
import { runHttpRequest } from '../src/modules/flows/http-request';

const ctx = { contact: { name: 'Ana', phone: '5500000000000' }, vars: { cpf: '123' } };

describe('caminhos no JSON da API externa', () => {
  const data = { cliente: { nome: 'Ana', 'nome completo': 'Ana Lima' }, itens: [{ preco: 10.5 }, { preco: 3 }], ativo: true, nada: null };
  it.each([
    ['cliente.nome', 'Ana'],
    ['$.cliente.nome', 'Ana'],
    ['itens[1].preco', 3],
    ['itens.0.preco', 10.5],
    ['cliente["nome completo"]', 'Ana Lima'],
    ['ativo', true],
  ])('%s', (p, v) => expect(readJsonPath(data, p)).toBe(v));

  it('caminho inexistente = undefined; nada herdado do protótipo', () => {
    expect(readJsonPath(data, 'cliente.idade')).toBeUndefined();
    expect(readJsonPath(data, 'itens[9].preco')).toBeUndefined();
    expect(readJsonPath(data, 'cliente.constructor')).toBeUndefined();
    expect(readJsonPath(data, '__proto__')).toBeUndefined();
  });
  it('caminho mal escrito = null', () => expect(parseJsonPath('a[b')).toBeNull());
  it('valor vira texto de variável', () => {
    expect(jsonValueText(10.5)).toBe('10.5');
    expect(jsonValueText(null)).toBe('');
    expect(jsonValueText([1, 2])).toBe('[1,2]');
  });
  it('lista os caminhos para escolher, com o primeiro item da lista', () => {
    const paths = listJsonPaths(data).map((p) => p.path);
    expect(paths).toEqual(expect.arrayContaining(['cliente.nome', 'cliente["nome completo"]', 'itens', 'itens[0].preco', 'ativo', 'nada']));
    expect(paths).not.toContain('itens[1].preco');
  });
  it('sugere nome de variável', () => {
    expect(suggestVarName('cliente.endereco.Cidade')).toBe('cidade');
    expect(suggestVarName('itens[0].preço')).toBe('preco');
  });
});

describe('runHttpRequest', () => {
  beforeEach(() => { call.mockReset(); });

  it('sucesso: interpola a URL, lê os campos e grava status/corpo', async () => {
    call.mockResolvedValue({ status: 200, body: JSON.stringify({ cliente: { nome: 'Ana' }, total: 99 }) });
    const out = await runHttpRequest({ method: 'GET', url: 'https://api.x.com/c/{{cpf}}', mappings: [{ id: '1', path: 'cliente.nome', varName: 'nome' }, { id: '2', path: 'falta', varName: 'falta' }], statusVar: 'st' }, ctx);
    expect(call.mock.calls[0][0]).toBe('https://api.x.com/c/123');
    expect(out.ok).toBe(true);
    expect(out.vars).toEqual({ nome: 'Ana', falta: '', st: '200' });
    expect(out.missing).toEqual(['falta']);
  });

  it('status fora de 2xx = erro e variáveis vazias', async () => {
    call.mockResolvedValue({ status: 404, body: '{"nome":"x"}' });
    const out = await runHttpRequest({ url: 'https://api.x.com', mappings: [{ id: '1', path: 'nome', varName: 'nome' }], statusVar: 'st' }, ctx);
    expect(out.ok).toBe(false);
    expect(out.vars).toEqual({ nome: '', st: '404' });
  });

  it('resposta que não é JSON com campos a ler = erro', async () => {
    call.mockResolvedValue({ status: 200, body: '<html>' });
    const out = await runHttpRequest({ url: 'https://api.x.com', mappings: [{ id: '1', path: 'nome', varName: 'nome' }] }, ctx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/não é JSON/);
  });

  it('sem resposta (rede) = status 0', async () => {
    call.mockImplementation(async () => { throw new Error('webhook não respondeu em 8 s'); });
    const out = await runHttpRequest({ url: 'https://api.x.com', statusVar: 'st' }, ctx);
    expect([out.ok, out.status, out.vars.st]).toEqual([false, 0, '0']);
    expect(out.error).toBe('a API não respondeu em 8 s');
  });

  it('corpo JSON com variável escapada', async () => {
    call.mockResolvedValue({ status: 201, body: '' });
    await runHttpRequest({ method: 'POST', url: 'https://api.x.com', body: '{"nome":"{{contact.name}}"}' }, { ...ctx, contact: { ...ctx.contact, name: 'Ana "A"' } });
    expect(call.mock.calls[0][1].body).toBe('{"nome":"Ana \\"A\\""}');
  });
});
