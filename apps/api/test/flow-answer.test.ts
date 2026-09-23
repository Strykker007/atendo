import { describe, expect, it } from 'vitest';
import { choose, interpolate, validAnswer } from '../src/modules/flows/answer';

const SERVICOS = [
  { id: 'svc-1', title: 'Corte' },
  { id: 'svc-2', title: 'Barba' },
  { id: 'svc-3', title: 'Corte + Barba' },
];

describe('choose — como o contato escolhe uma opção', () => {
  it('id do botão tem prioridade (Meta oficial)', () => {
    expect(choose(SERVICOS, 'qualquer coisa', 'svc-2')).toBe(SERVICOS[1]);
  });

  it('número da opção (Evolution, lista numerada)', () => {
    expect(choose(SERVICOS, '1')).toBe(SERVICOS[0]);
    expect(choose(SERVICOS, '3')).toBe(SERVICOS[2]);
  });

  it('aceita número com espaços em volta', () => {
    expect(choose(SERVICOS, '  2  ')).toBe(SERVICOS[1]);
  });

  it('texto exato, sem diferenciar maiúsculas', () => {
    expect(choose(SERVICOS, 'BARBA')).toBe(SERVICOS[1]);
  });

  it('texto parcial a partir de 3 letras', () => {
    expect(choose(SERVICOS, 'cor')).toBe(SERVICOS[0]);
  });

  it('texto parcial curto demais não escolhe (evita chute perigoso)', () => {
    expect(choose(SERVICOS, 'co')).toBeUndefined();
    expect(choose(SERVICOS, 'ba')).toBeUndefined();
  });

  it('número fora da lista não escolhe', () => {
    expect(choose(SERVICOS, '0')).toBeUndefined();
    expect(choose(SERVICOS, '4')).toBeUndefined();
    expect(choose(SERVICOS, '-1')).toBeUndefined();
  });

  it('resposta vazia ou sem relação não escolhe', () => {
    expect(choose(SERVICOS, '')).toBeUndefined();
    expect(choose(SERVICOS, 'bom dia, tudo bem?')).toBeUndefined();
  });

  it('id desconhecido cai para a interpretação por texto em vez de falhar', () => {
    expect(choose(SERVICOS, '2', 'id-que-nao-existe')).toBe(SERVICOS[1]);
  });

  it('prefere o título exato ao parcial', () => {
    const opts = [{ id: 'a', title: 'Corte simples' }, { id: 'b', title: 'Corte' }];
    expect(choose(opts, 'corte')).toBe(opts[1]);
  });

  it('funciona com horários como opção (id = ISO, título = rótulo)', () => {
    const horarios = [
      { id: '2026-09-22T12:00:00.000Z', title: 'ter. 22/09 09:00' },
      { id: '2026-09-22T12:30:00.000Z', title: 'ter. 22/09 09:30' },
    ];
    expect(choose(horarios, '', '2026-09-22T12:30:00.000Z')).toBe(horarios[1]);
    expect(choose(horarios, '2')).toBe(horarios[1]);
  });
});

describe('validAnswer', () => {
  it('none aceita qualquer texto, menos vazio', () => {
    expect(validAnswer('qualquer coisa', 'none')).toBe(true);
    expect(validAnswer('', 'none')).toBe(false);
  });

  it('email', () => {
    expect(validAnswer('tiago@exemplo.com.br', 'email')).toBe(true);
    expect(validAnswer('tiago@exemplo', 'email')).toBe(false);
    expect(validAnswer('tiago exemplo.com', 'email')).toBe(false);
    expect(validAnswer('@exemplo.com', 'email')).toBe(false);
  });

  it('telefone: 10 dígitos ou mais, aceitando máscara', () => {
    expect(validAnswer('+55 (62) 99999-8888', 'phone')).toBe(true);
    expect(validAnswer('6299998888', 'phone')).toBe(true);
    expect(validAnswer('99998888', 'phone')).toBe(false);
  });

  it('número aceita vírgula decimal (é como o brasileiro digita)', () => {
    expect(validAnswer('12,50', 'number')).toBe(true);
    expect(validAnswer('12.50', 'number')).toBe(true);
    expect(validAnswer('doze', 'number')).toBe(false);
  });
});

describe('interpolate', () => {
  const ctx = { contact: { name: 'Bruno', phone: '5511999999999' }, vars: { servico: 'Corte', horario: 'ter. 22/09 09:00' } };

  it('substitui dados do contato e variáveis do fluxo', () => {
    expect(interpolate('Olá {{contact.name}}! {{servico}} em {{horario}}.', ctx)).toBe('Olá Bruno! Corte em ter. 22/09 09:00.');
    expect(interpolate('{{contact.phone}}', ctx)).toBe('5511999999999');
  });

  it('tolera espaços dentro das chaves', () => {
    expect(interpolate('Olá {{ contact.name }}', ctx)).toBe('Olá Bruno');
  });

  it('variável inexistente vira vazio — nunca vaza {{chave}} para o cliente', () => {
    expect(interpolate('Oi {{nao_existe}}!', ctx)).toBe('Oi !');
  });

  it('contato sem nome não escreve "null"', () => {
    expect(interpolate('Olá {{contact.name}}!', { ...ctx, contact: { name: null, phone: '55' } })).toBe('Olá !');
  });

  it('texto sem variáveis passa intacto', () => {
    expect(interpolate('Bom dia!', ctx)).toBe('Bom dia!');
  });
});
