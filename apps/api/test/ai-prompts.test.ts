import { describe, expect, it } from 'vitest';
import { aiCostUsd, priceOf } from '@atendo/shared';
import { HISTORY_LIMIT, answerSystemPrompt, classifySystemPrompt, rewriteSystemPrompt, summarySystemPrompt, toMessages } from '../src/modules/ai/prompts';

describe('toMessages — o que é enviado ao modelo', () => {
  it('traduz direção em papel', () => {
    expect(toMessages([
      { direction: 'in', text: 'oi' },
      { direction: 'out', text: 'olá!' },
      { direction: 'in', text: 'quanto custa o corte?' },
    ])).toEqual([
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'olá!' },
      { role: 'user', content: 'quanto custa o corte?' },
    ]);
  });

  it('NUNCA envia nota interna — é conversa entre gerente e atendente', () => {
    const msgs = toMessages([
      { direction: 'in', text: 'oi' },
      { direction: 'out', text: 'cliente reclamão, cuidado', internal: true },
    ]);
    expect(JSON.stringify(msgs)).not.toContain('reclamão');
  });

  it('descarta mensagens vazias ou só com espaço', () => {
    expect(toMessages([{ direction: 'in', text: 'oi' }, { direction: 'out', text: null }, { direction: 'out', text: '   ' }])).toHaveLength(1);
  });

  it('começa sempre pelo cliente (exigência dos modelos)', () => {
    const msgs = toMessages([{ direction: 'out', text: 'campanha' }, { direction: 'out', text: 'promo' }, { direction: 'in', text: 'oi' }]);
    expect(msgs).toEqual([{ role: 'user', content: 'oi' }]);
  });

  it('conversa só com mensagens nossas vira lista vazia (o serviço recusa antes de gastar)', () => {
    expect(toMessages([{ direction: 'out', text: 'oi' }])).toEqual([]);
  });

  it('limita o histórico e o tamanho de cada mensagem — é o que controla o custo', () => {
    const longa = Array.from({ length: 40 }, (_, i) => ({ direction: 'in' as const, text: `m${i}` }));
    expect(toMessages(longa)).toHaveLength(HISTORY_LIMIT);
    const gigante = toMessages([{ direction: 'in', text: 'x'.repeat(5000) }]);
    expect(gigante[0].content.length).toBeLessThanOrEqual(600);
  });
});

describe('prompts', () => {
  it('a resposta ao cliente proíbe inventar e manda chamar humano', () => {
    const p = answerSystemPrompt({ businessName: 'Barbearia do Carlos', instructions: 'Atendemos de terça a sábado.' });
    expect(p).toContain('Barbearia do Carlos');
    expect(p).toContain('Nunca invente preço');
    expect(p).toContain('chamar um atendente');
    expect(p).toContain('Atendemos de terça a sábado.');
  });

  it('trata a conversa como dado, não como ordem (proteção contra injeção pelo contato)', () => {
    for (const p of [answerSystemPrompt({ businessName: 'X', instructions: 'i' }), classifySystemPrompt({ instructions: '', labels: [{ id: 'a', label: 'A' }] }), summarySystemPrompt()]) {
      expect(p.toLowerCase()).toContain('não ordens');
    }
  });

  it('a base de conhecimento é apresentada como única fonte de fatos', () => {
    const p = answerSystemPrompt({ businessName: 'X', instructions: 'i', knowledge: 'Corte R$ 45' });
    expect(p).toContain('única fonte de fatos');
    expect(p).toContain('Corte R$ 45');
  });

  it('sem instruções, o prompt ainda é válido', () => {
    expect(answerSystemPrompt({ businessName: 'X', instructions: '   ' })).toContain('(sem instruções específicas)');
  });

  it('classificar pede só o id e prevê "nenhuma"', () => {
    const p = classifySystemPrompt({ instructions: '', labels: [{ id: 'agendar', label: 'Quer marcar horário' }, { id: 'preco', label: 'Perguntou preço' }] });
    expect(p).toContain('agendar: Quer marcar horário');
    expect(p).toContain('nenhuma');
    expect(p).toContain('APENAS com o identificador');
  });

  it('reescrever não pode inventar nem mudar números', () => {
    const p = rewriteSystemPrompt('formal');
    expect(p).toContain('mais formal');
    expect(p).toContain('não mude números, datas ou valores');
  });

  it('o resumo só pode usar o que está na conversa', () => {
    expect(summarySystemPrompt()).toContain('Use só o que está na conversa');
  });
});

describe('custo da IA', () => {
  it('calcula pelo modelo, separando entrada e saída', () => {
    const p = priceOf('gpt-4o-mini');
    expect(aiCostUsd('gpt-4o-mini', 1000, 1000)).toBeCloseTo(p.inputPer1k + p.outputPer1k, 10);
  });

  it('modelo desconhecido assume o mais caro — nunca subestima o custo', () => {
    const desconhecido = aiCostUsd('modelo-que-nao-existe', 1000, 1000);
    const maisCaro = Math.max(...['gpt-4o', 'claude-sonnet-5'].map((m) => aiCostUsd(m, 1000, 1000)));
    expect(desconhecido).toBeGreaterThanOrEqual(maisCaro);
  });

  it('sem tokens, sem custo', () => {
    expect(aiCostUsd('gpt-4o-mini', 0, 0)).toBe(0);
  });
});
