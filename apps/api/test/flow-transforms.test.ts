import { describe, expect, it, vi } from 'vitest';
vi.mock('@atendo/shared', () => import('../../../packages/shared/src/index'));
import type { VariableAssignment } from '../../../packages/shared/src/flows';
import { applyAssignments } from '../src/modules/flows/variables';
import { evaluateArithmetic } from '../src/modules/flows/arithmetic';
import { transformVariable } from '../src/modules/flows/variable-transforms';
import { evaluateRule, type RuleEnv } from '../src/modules/flows/conditions';

const env = { contact: { name: 'Ana', phone: '55' }, now: new Date('2026-10-16T00:00:00Z'), timezone: 'America/Sao_Paulo' };
const operation = (op: VariableAssignment['op'], value: string, params: Partial<VariableAssignment> = {}): VariableAssignment => ({ id: 'a', varName: 'result', op, value, ...params });
const transform = (op: VariableAssignment['op'], value: string, params: Partial<VariableAssignment> = {}) => transformVariable(operation(op, value, params), value, (key) => ({ total: '1.234,56' })[key as 'total'] ?? '', env.timezone);

describe('transformações declarativas', () => {
  it.each([
    ['upper', 'olá', {}, 'OLÁ'], ['lower', 'OLÁ', {}, 'olá'], ['trim', '  oi \n', {}, 'oi'],
    ['replace', 'a-a', { pattern: 'a', replacement: 'b' }, 'b-b'],
    ['replace', 'ab12cd34', { pattern: '\\d+', replacement: '$&', regex: true }, 'ab$&cd$&'],
    ['extract', 'Pedido 123', { pattern: '(\\d+)' }, '123'],
    ['extract', 'Pedido', { pattern: '(\\d+)' }, ''],
    ['slice', 'abcdef', { start: '1', length: '3' }, 'bcd'],
    ['to_number', '1.234,56', {}, '1234.56'], ['to_number', '1234.56', {}, '1234.56'],
    ['round', '12.345', { decimals: '2' }, '12.35'],
    ['currency', '1234.56', {}, 'R$\u00a01.234,56'],
    ['expression', '{{total}} + 1', {}, '1235.56'],
    ['json_path', '{"a":{"b":[{"c":42}]}}', { path: 'a.b[0].c' }, '42'],
    ['json_path', '{"a":[1,2]}', { path: 'a' }, '[1,2]'],
    ['json_path', '{}', { path: 'missing' }, ''],
    ['list_count', '[1,2,3]', {}, '3'],
    ['date_format', '2026-10-16T01:00:00Z', {}, '15/10/2026'],
    ['date_format', '2024-02-29', {}, '29/02/2024'],
    ['date_add', '28/02/2024', { days: '1' }, '2024-02-29'],
    ['date_add', '2026-01-01', { days: '-1' }, '2025-12-31'],
    ['date_diff', '2026-10-16', { otherDate: '15/10/2026' }, '1'],
  ] as [VariableAssignment['op'], string, Partial<VariableAssignment>, string][])('%s: %s', (op, value, params, expected) => expect(transform(op, value, params)).toBe(expected));

  it.each([
    operation('to_number', 'texto'), operation('round', '10', { decimals: '100' }),
    operation('list_count', '{}'), operation('json_path', 'bad', { path: 'a' }),
    operation('json_path', '{}', { path: 'a[' }), operation('date_format', '31/02/2026'),
    operation('date_format', '2026-10-16T12:00:00'), operation('date_add', '2026-10-16', { days: 'a' }),
    operation('expression', '1/0'), operation('extract', 'a'.repeat(2001), { pattern: '(a+)' }),
    operation('extract', 'aaaa!', { pattern: '(a+)+' }), operation('extract', 'abc', { pattern: '(a|b)+' }),
    operation('extract', 'abc', { pattern: 'a{999999999}' }),
  ])('erro em $op esvazia destino e continua', (a) => {
    const out = applyAssignments({ result: 'antigo' }, [a, { ...operation('set', 'continua'), varName: 'next' }], env);
    expect(out.vars).toEqual({ result: '', next: 'continua' }); expect(out.problems).toHaveLength(1);
  });
  it('operações enxergam os resultados anteriores', () => {
    const out = applyAssignments({}, [operation('trim', '  oi '), operation('upper', '{{result}}')], env);
    expect(out.vars.result).toBe('OI'); expect(out.problems).toEqual([]);
  });
  it('diferença de dias é civil durante horário de verão', () => {
    const a = operation('date_diff', '2026-03-09T04:00:00Z', { otherDate: '2026-03-08T05:00:00Z' });
    expect(transformVariable(a, a.value, () => '', 'America/New_York')).toBe('1');
  });
  it('não lê propriedades do protótipo', () => {
    expect(transform('json_path', '{}', { path: '__proto__' })).toBe('');
    expect(transform('json_path', '{}', { path: 'constructor' })).toBe('');
  });
});

describe('parser aritmético', () => {
  it.each([['1+2*3', 7], ['(1+2)*3', 9], ['-2 * -(3+1)', 8], ['10/2-1', 4], ['.5 + 1.5', 2]])('%s', (source, expected) => expect(evaluateArithmetic(source, () => '')).toBe(expected));
  it.each(['x', 'process.exit()', '1;alert(1)', '2 ** 3', 'Math.random()', '(1+2', '1+2)', '1/0', '1 2', '1+'.repeat(600), '('.repeat(40)+'1'+')'.repeat(40), '{{missing}}'])('rejeita %s', (source) => expect(() => evaluateArithmetic(source, () => '')).toThrow());
  it('variável não injeta código', () => expect(() => evaluateArithmetic('{{x}} + 1', () => '1+2')).toThrow());
});

describe('condição com valores transformados', () => {
  it('igualdade considera representações numéricas equivalentes', async () => {
    expect(await evaluateRule({ id: 'r', operand: 'var', key: 'total', op: 'eq', value: '1234.56' }, { ...env, vars: { total: '1.234,56' } } as unknown as RuleEnv)).toBe(true);
  });
});
