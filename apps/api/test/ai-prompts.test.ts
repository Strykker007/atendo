import { describe, expect, it } from 'vitest';
import { aiCostUsd, priceOf } from '@atendo/shared';
import { HISTORY_LIMIT, answerSystemPrompt, classifySystemPrompt, rewriteSystemPrompt, suggestSystemPrompt, summarySystemPrompt, toMessages, toTranscript, transcriptMessage } from '../src/modules/ai/prompts';

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


describe('toTranscript — formato usado pelo copiloto', () => {
  const conversa = [
    { direction: 'in' as const, text: 'quanto custa o corte?' },
    { direction: 'out' as const, text: 'R$ 45' },
    { direction: 'out' as const, text: 'Quer marcar?' },
    { direction: 'out' as const, text: 'Qualquer coisa é só chamar!' },
  ];

  it('funciona quando a conversa termina com mensagens NOSSAS', () => {
    // era o bug: como turnos alternados, o último turno virava "assistant" e o modelo,
    // entendendo que devia continuar a própria fala, devolvia vazio
    expect(toMessages(conversa).at(-1)?.role).toBe('assistant');
    expect(toTranscript(conversa)).toBe('CLIENTE: quanto custa o corte?\nATENDIMENTO: R$ 45\nATENDIMENTO: Quer marcar?\nATENDIMENTO: Qualquer coisa é só chamar!');
  });

  it('identifica quem falou em cada linha', () => {
    expect(toTranscript([{ direction: 'in', text: 'oi' }])).toBe('CLIENTE: oi');
    expect(toTranscript([{ direction: 'out', text: 'olá' }])).toBe('ATENDIMENTO: olá');
  });

  it('também não inclui nota interna', () => {
    expect(toTranscript([{ direction: 'in', text: 'oi' }, { direction: 'out', text: 'cliente reclamão', internal: true }])).toBe('CLIENTE: oi');
  });

  it('respeita os mesmos limites de histórico e tamanho', () => {
    const longa = Array.from({ length: 40 }, (_, i) => ({ direction: 'in' as const, text: `m${i}` }));
    expect(toTranscript(longa).split('\n')).toHaveLength(HISTORY_LIMIT);
    expect(toTranscript([{ direction: 'in', text: 'x'.repeat(5000) }]).length).toBeLessThanOrEqual(620);
  });

  it('conversa vazia vira string vazia (o serviço recusa antes de gastar)', () => {
    expect(toTranscript([{ direction: 'out', text: null }])).toBe('');
  });

  it('transcriptMessage delimita a conversa e vai como turno do usuário', () => {
    const m = transcriptMessage('CLIENTE: oi', 'Resuma esta conversa.');
    expect(m.role).toBe('user');
    expect(m.content).toContain('<conversa>');
    expect(m.content).toContain('</conversa>');
    expect(m.content.endsWith('Resuma esta conversa.')).toBe(true);
  });
});

describe('suggestSystemPrompt — quem é o cliente', () => {
  it('diz o nome do cliente e manda tratar por ele', () => {
    const p = suggestSystemPrompt({ businessName: 'Loja', agentName: 'Ana', contactName: 'João', contactPhone: '5511999999999' });
    expect(p).toContain('O cliente desta conversa se chama João');
    expect(p).toContain('5511999999999');
  });

  it('avisa que nome no meio da conversa é de terceiro — a confusão que trocava João por Maria', () => {
    const p = suggestSystemPrompt({ businessName: 'Loja', agentName: 'Ana', contactName: 'João' });
    expect(p).toMatch(/terceiros/i);
    expect(p).toMatch(/Nunca trate o cliente por eles/i);
  });

  it('sem nome cadastrado, proíbe inventar em vez de ficar em silêncio', () => {
    const p = suggestSystemPrompt({ businessName: 'Loja', agentName: 'Ana', contactName: null });
    expect(p).toMatch(/não está cadastrado/i);
    expect(p).toMatch(/Não invente um nome/i);
  });
});
