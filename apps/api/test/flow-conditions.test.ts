import { describe, expect, it } from 'vitest';
import { normalizeCondition, type ConditionBranch, type ConditionRule } from '@atendo/shared';
import { evaluateRule, fold, pickBranch, toNumber, type RuleEnv } from '../src/modules/flows/conditions';
import { applyAssignments, formatNow } from '../src/modules/flows/variables';
import { validateDefinition } from '../src/modules/flows/flow-validation';
import { toPortable, fromPortable, tagNamesOf } from '../src/modules/flows/portable';

// segunda-feira 2026-10-05 14:30 em São Paulo (UTC-3)
const NOW = new Date('2026-10-05T17:30:00Z');

const env = (over: Partial<RuleEnv> = {}): RuleEnv => ({
  contact: { name: 'José da Silva', phone: '+5500000000000', email: null, address: 'Rua São João', note1: null, note2: null },
  vars: { cidade: 'São Paulo', idade: '30', total: '10,5', vazia: '' },
  now: NOW,
  timezone: async () => 'America/Sao_Paulo',
  lastMessage: async () => 'Quero CANCELAR o pedido',
  hasTag: async (id) => id === 'vip',
  isOpen: async (hours) => !hours,
  ...over,
});
const rule = (r: Partial<ConditionRule>): ConditionRule => ({ id: 'r', operand: 'var', key: 'cidade', op: 'eq', ...r });
const ok = (r: Partial<ConditionRule>, e = env()) => evaluateRule(rule(r), e);

describe('Condição — comparadores de texto', () => {
  it('ignora maiúsculas e acentos por padrão', async () => {
    expect(await ok({ value: 'sao paulo' })).toBe(true);
    expect(await ok({ value: '  SÃO PAULO ' })).toBe(true);
    expect(await ok({ value: 'sao paulo', caseSensitive: true })).toBe(false);
    expect(await ok({ value: 'São Paulo', caseSensitive: true })).toBe(true);
  });
  it('diferente, contém, não contém, começa e termina com', async () => {
    expect(await ok({ op: 'neq', value: 'Rio' })).toBe(true);
    expect(await ok({ op: 'contains', value: 'paulo' })).toBe(true);
    expect(await ok({ op: 'not_contains', value: 'rio' })).toBe(true);
    expect(await ok({ op: 'starts_with', value: 'sao' })).toBe(true);
    expect(await ok({ op: 'ends_with', value: 'PAULO' })).toBe(true);
    expect(await ok({ op: 'ends_with', value: 'sao' })).toBe(false);
  });
  it('valor aceita {{variáveis}}', async () => {
    expect(await ok({ key: 'cidade', value: '{{cidade}}' })).toBe(true);
    expect(await ok({ operand: 'contact', key: 'name', op: 'contains', value: '{{contact.address}}' })).toBe(false);
  });
});

describe('Condição — números e existência', () => {
  it('compara como número, aceitando vírgula decimal', async () => {
    expect(await ok({ key: 'idade', op: 'gte', value: '18' })).toBe(true);
    expect(await ok({ key: 'idade', op: 'lt', value: '18' })).toBe(false);
    expect(await ok({ key: 'idade', op: 'num_eq', value: '30,0' })).toBe(true);
    expect(await ok({ key: 'idade', op: 'num_neq', value: '30' })).toBe(false);
    expect(await ok({ key: 'total', op: 'gt', value: '10.4' })).toBe(true);
    expect(await ok({ key: 'total', op: 'lte', value: '10,5' })).toBe(true);
  });
  it('não-número torna a regra falsa (nos dois sentidos)', async () => {
    expect(await ok({ key: 'cidade', op: 'gt', value: '1' })).toBe(false);
    expect(await ok({ key: 'cidade', op: 'num_neq', value: '1' })).toBe(false);
    expect(await ok({ key: 'vazia', op: 'lt', value: '1' })).toBe(false);
  });
  it('vazio / não vazio, inclusive variável inexistente', async () => {
    expect(await ok({ key: 'vazia', op: 'empty' })).toBe(true);
    expect(await ok({ key: 'nao_existe', op: 'empty' })).toBe(true);
    expect(await ok({ key: 'cidade', op: 'not_empty' })).toBe(true);
    expect(await ok({ operand: 'contact', key: 'email', op: 'empty' })).toBe(true);
  });
  it('toNumber', () => {
    expect(toNumber('1.234,56')).toBe(1234.56);
    expect(toNumber('10.5')).toBe(10.5);
    expect(toNumber('')).toBeNaN();
    expect(fold('Ação É')).toBe('acao e');
  });
});

describe('Condição — operandos', () => {
  it('campo do contato e mensagem recebida', async () => {
    expect(await ok({ operand: 'contact', key: 'name', op: 'starts_with', value: 'jose' })).toBe(true);
    expect(await ok({ operand: 'contact', key: 'address', op: 'contains', value: 'sao joao' })).toBe(true);
    expect(await ok({ operand: 'message', op: 'contains', value: 'cancelar' })).toBe(true);
  });
  it('data/hora atual no fuso do cliente', async () => {
    expect(await ok({ operand: 'now', op: 'weekday_in', days: [1] })).toBe(true); // segunda
    expect(await ok({ operand: 'now', op: 'weekday_in', days: [0, 6] })).toBe(false);
    expect(await ok({ operand: 'now', op: 'time_between', from: '08:00', to: '18:00' })).toBe(true);
    expect(await ok({ operand: 'now', op: 'time_between', from: '14:31', to: '18:00' })).toBe(false);
    // fim exclusivo
    expect(await ok({ operand: 'now', op: 'time_between', from: '08:00', to: '14:30' })).toBe(false);
    // atravessa a meia-noite
    expect(await ok({ operand: 'now', op: 'time_between', from: '22:00', to: '06:00' })).toBe(false);
    const night = env({ now: new Date('2026-10-06T04:00:00Z') }); // 01:00 local
    expect(await ok({ operand: 'now', op: 'time_between', from: '22:00', to: '06:00' }, night)).toBe(true);
    expect(await ok({ operand: 'now', op: 'time_between', from: '8h', to: '18:00' })).toBe(false);
  });
  it('etiqueta e horário comercial', async () => {
    expect(await ok({ operand: 'tag', op: 'is_true', tagId: 'vip' })).toBe(true);
    expect(await ok({ operand: 'tag', op: 'is_false', tagId: 'vip' })).toBe(false);
    expect(await ok({ operand: 'tag', op: 'is_true' })).toBe(false);
    expect(await ok({ operand: 'business_hours', op: 'is_true' })).toBe(true);
    expect(await ok({ operand: 'business_hours', op: 'is_false', hours: { start: '08:00', end: '18:00', days: [1] } })).toBe(true);
  });
  it('só consulta o que a regra usa', async () => {
    let calls = 0;
    const e = env({ lastMessage: async () => { calls++; return ''; } });
    await ok({ value: 'x' }, e);
    expect(calls).toBe(0);
  });
  it('operando desconhecido não casa', async () => {
    expect(await ok({ operand: 'futuro' as never, op: 'is_true' })).toBe(false);
  });
});

describe('Condição — ramos', () => {
  const branches: ConditionBranch[] = [
    { id: 'menor', label: 'Menor', match: 'all', rules: [rule({ key: 'idade', op: 'lt', value: '18' })] },
    { id: 'sp_ou_vip', label: 'SP ou VIP', match: 'any', rules: [rule({ value: 'rio' }), rule({ operand: 'tag', op: 'is_true', tagId: 'vip' })] },
    { id: 'tambem', label: 'Também verdadeiro', match: 'all', rules: [rule({ op: 'not_empty' })] },
  ];
  it('primeiro verdadeiro vence; OU dentro do ramo', async () => {
    expect(await pickBranch(branches, env())).toBe('sp_ou_vip');
  });
  it('E exige todas', async () => {
    const b: ConditionBranch = { id: 'e', label: '', match: 'all', rules: [rule({ value: 'sao paulo' }), rule({ key: 'idade', op: 'gt', value: '40' })] };
    expect(await pickBranch([b], env())).toBe('no');
  });
  it('nenhum verdadeiro → Senão; ramo sem regras nunca vence', async () => {
    expect(await pickBranch([{ id: 'x', label: '', match: 'all', rules: [] }], env())).toBe('no');
    expect(await pickBranch([], env())).toBe('no');
  });
});

describe('Condição — formato antigo', () => {
  it('vira um ramo "yes" + Senão "no", com a mesma semântica', async () => {
    const b = normalizeCondition({ kind: 'var_equals', varName: 'contact.name', value: 'josé da silva' });
    expect(b).toHaveLength(1);
    expect(b[0].id).toBe('yes');
    expect(b[0].rules[0]).toMatchObject({ operand: 'contact', key: 'name', op: 'eq' });
    expect(await pickBranch(b, env())).toBe('yes');
    expect(await pickBranch(normalizeCondition({ kind: 'var_contains', varName: 'cidade', value: 'rio' }), env())).toBe('no');
    expect(await pickBranch(normalizeCondition({ kind: 'var_filled', varName: 'cidade' }), env())).toBe('yes');
    expect(await pickBranch(normalizeCondition({ kind: 'has_tag', tagId: 'vip' }), env())).toBe('yes');
    expect(normalizeCondition({ kind: 'business_hours', hours: { start: '08:00', end: '12:00', days: [1] } })[0].rules[0]).toMatchObject({ operand: 'business_hours', hours: { end: '12:00' } });
  });
  it('formato novo passa direto', () => {
    const branches: ConditionBranch[] = [{ id: 'a', label: 'A', match: 'any', rules: [] }];
    expect(normalizeCondition({ branches })).toBe(branches);
  });
});

describe('Condição — validação e portabilidade', () => {
  const def = (data: Record<string, unknown>) => ({
    nodes: [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'c', type: 'condition', position: { x: 0, y: 0 }, data },
    ],
    edges: [{ id: 'e', source: 's', target: 'c' }],
  }) as never;
  it('aceita formato antigo e recusa regra incompleta', () => {
    expect(() => validateDefinition(def({ kind: 'var_equals', varName: 'x', value: '1' }))).not.toThrow();
    expect(() => validateDefinition(def({ branches: [{ id: 'a', label: 'A', match: 'all', rules: [] }] }))).toThrow(/ao menos uma regra/);
    expect(() => validateDefinition(def({ branches: [{ id: 'a', label: 'A', match: 'all', rules: [rule({ operand: 'now', op: 'eq' })] }] }))).toThrow(/comparador/);
    expect(() => validateDefinition(def({ branches: [{ id: 'a', label: 'A', match: 'all', rules: [rule({ operand: 'now', op: 'time_between', from: '8', to: '18:00' })] }] }))).toThrow(/HH:MM/);
  });
  it('Manipulador recusa somar/subtrair valor fixo que não é número', () => {
    const manip = (value: string, o = 'add') => ({
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'm', type: 'variable', position: { x: 0, y: 0 }, data: { assignments: [{ id: 'a', varName: 'v', op: o, value }] } },
      ],
      edges: [{ id: 'e', source: 's', target: 'm' }],
    }) as never;
    expect(() => validateDefinition(manip('abc'))).toThrow(/não é um número/);
    expect(() => validateDefinition(manip('', 'subtract'))).toThrow(/não é um número/);
    expect(() => validateDefinition(manip('10,5'))).not.toThrow();
    expect(() => validateDefinition(manip('{{outra}}'))).not.toThrow();
    expect(() => validateDefinition(manip('abc', 'append'))).not.toThrow();
  });
  it('etiqueta dentro das regras viaja pelo nome', () => {
    const data = { branches: [{ id: 'a', label: 'A', match: 'all', rules: [rule({ operand: 'tag', op: 'is_true', tagId: 't1' })] }] };
    const flow = { name: 'F', trigger: { type: 'manual' as const }, definition: def(data) };
    const { portable } = toPortable(flow, { t1: 'VIP' });
    expect(tagNamesOf(portable)).toEqual(['VIP']);
    const back = fromPortable(portable, { VIP: 't9' });
    const r = (back.definition.nodes[1].data as { branches: ConditionBranch[] }).branches[0].rules[0];
    expect(r.tagId).toBe('t9');
    expect((r as { tagName?: string }).tagName).toBeUndefined();
  });
});

describe('Manipulador', () => {
  const ctx = { contact: { name: 'Ana', phone: '+5500000000000' }, now: NOW, timezone: 'America/Sao_Paulo' };
  const run = (vars: Record<string, string>, ops: Parameters<typeof applyAssignments>[1]) => applyAssignments(vars, ops, ctx).vars;
  const op = (o: Partial<Parameters<typeof applyAssignments>[1][number]>) => ({ id: 'x', varName: 'v', value: '', ...o });

  it('definir (padrão para fluxos antigos sem op) com interpolação', () => {
    expect(run({}, [op({ value: 'Olá {{contact.name}}' })])).toEqual({ v: 'Olá Ana' });
    expect(run({ a: '1' }, [op({ op: 'set', value: '{{a}}-{{b}}' })]).v).toBe('1-');
  });
  it('somar e subtrair (vazio = 0, vírgula decimal, sem lixo de float)', () => {
    expect(run({}, [op({ op: 'add', value: '1' })]).v).toBe('1');
    expect(run({ v: '0,1' }, [op({ op: 'add', value: '0.2' })]).v).toBe('0.3');
    expect(run({ v: '10' }, [op({ op: 'subtract', value: '{{n}}' })]).v).toBe('10'); // {{n}} vazio → não é número
    expect(run({ v: '10', n: '3' }, [op({ op: 'subtract', value: '{{n}}' })]).v).toBe('7');
    expect(run({ v: 'abc' }, [op({ op: 'add', value: '1' })]).v).toBe('abc');
  });
  it('soma impossível vira problema relatado, nunca silêncio', () => {
    const texto = applyAssignments({ v: '10' }, [op({ op: 'add', value: 'abc' })], ctx);
    expect(texto.vars.v).toBe('10');
    expect(texto.problems).toHaveLength(1);
    expect(texto.problems[0]).toMatch(/somar "abc" em \{\{v\}\}: não é um número/);
    const atual = applyAssignments({ v: 'oi' }, [op({ op: 'subtract', value: '1' })], ctx);
    expect(atual.problems[0]).toMatch(/valor atual \("oi"\) não é um número/);
    expect(applyAssignments({ v: '1' }, [op({ op: 'add', value: '2' })], ctx).problems).toEqual([]);
  });
  it('acrescentar, limpar e copiar', () => {
    expect(run({ v: 'a' }, [op({ op: 'append', value: 'b' })]).v).toBe('ab');
    expect(run({ v: 'a' }, [op({ op: 'clear' })]).v).toBe('');
    expect(run({ origem: 'x' }, [op({ op: 'copy', from: 'origem' })]).v).toBe('x');
    expect(run({}, [op({ op: 'copy', from: 'contact.name' })]).v).toBe('Ana');
    expect(run({}, [op({ op: 'copy' })]).v).toBe('');
  });
  it('data/hora atual no fuso do cliente', () => {
    expect(run({}, [op({ op: 'now' })]).v).toBe('05/10/2026 14:30');
    expect(run({}, [op({ op: 'now', format: 'date' })]).v).toBe('05/10/2026');
    expect(run({}, [op({ op: 'now', format: 'time' })]).v).toBe('14:30');
    expect(formatNow(NOW, 'UTC', 'time')).toBe('17:30');
  });
  it('executa em ordem e não altera o original', () => {
    const vars = { c: '1' };
    const out = run(vars, [op({ varName: 'c', op: 'add', value: '1' }), op({ varName: 'c', op: 'add', value: '{{c}}' }), op({ varName: 'msg', op: 'set', value: 'total {{c}}' }), op({ varName: '' , op: 'clear' })]);
    expect(out).toEqual({ c: '4', msg: 'total 4' });
    expect(vars).toEqual({ c: '1' });
  });
});
