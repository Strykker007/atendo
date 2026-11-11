import { describe, expect, it } from 'vitest';
import type { AiAgentConfig } from '@atendo/shared';
import { agentSystemPrompt, parseAgentReply, stageOf, toolsOf, type AgentCatalog } from '../src/modules/ai/agent-prompt';

const catalog: AgentCatalog = {
  departments: [{ id: 'dep-vendas', name: 'Vendas' }, { id: 'dep-rh', name: 'RH' }],
  tags: [{ id: 'tag-quente', name: 'Lead quente' }],
  closeReasons: [{ id: 'cr-ok', name: 'Resolvido' }],
  customFields: ['Convênio'],
};
const agent: AiAgentConfig = {
  name: 'Ana', persona: 'Você é a Ana, da Farmácia Modelo.', tone: 'friendly', rules: 'Nunca dê desconto.', knowledge: 'Abrimos das 8h às 20h.',
  stages: [
    { id: 'inicio', name: 'Boas-vindas', goal: 'Cumprimente e pergunte o que precisa.', transitions: [{ to: 'pedido', when: 'disse o que quer' }], tools: ['add_tag'] },
    { id: 'pedido', name: 'Pedido', goal: 'Descubra produto e quantidade.', transitions: [], tools: ['transfer_department', 'set_contact_field', 'close'] },
  ],
  targets: { departmentIds: ['dep-vendas'], tagIds: ['tag-quente'], closeReasonIds: ['cr-ok'], contactFields: ['name', 'attribute:Convênio'] },
  maxReplies: 20, isActive: true,
};
const inicio = agent.stages[0];
const pedido = agent.stages[1];
const parse = (raw: unknown, stage = inicio) => parseAgentReply(typeof raw === 'string' ? raw : JSON.stringify(raw), { agent, stage, catalog });

describe('stageOf / toolsOf', () => {
  it('etapa desconhecida cai na primeira', () => {
    expect(stageOf(agent, 'nao-existe')?.id).toBe('inicio');
    expect(stageOf(agent, null)?.id).toBe('inicio');
  });
  it('chamar atendente vale em toda etapa', () => {
    expect(toolsOf(inicio)).toContain('handoff');
  });
});

describe('agentSystemPrompt', () => {
  it('traz persona, regra do cliente, base, etapa e só os alvos liberados', () => {
    const p = agentSystemPrompt({ agent, stage: pedido, businessName: 'Farmácia Modelo', catalog });
    expect(p).toContain('Você é a Ana');
    expect(p).toContain('Nunca dê desconto.');
    expect(p).toContain('Abrimos das 8h às 20h.');
    expect(p).toContain('ETAPA ATUAL: Pedido');
    expect(p).toContain('dep-vendas = Vendas');
    expect(p).not.toContain('dep-rh');
    expect(p).toContain('attribute:Convênio = Convênio');
  });
});

describe('parseAgentReply', () => {
  it('quebra de linha crua dentro do reply (Gemini) não derruba a rodada', () => {
    const raw = '```json\n{"reply": "Pelo Art. 20.2, não dá para reservar!\n\nOs valores:\\n• Gourmet 01: 20%", "next_stage": "", "actions": [], "done": false}\n```';
    const t = parse(raw);
    expect(t?.reply).toBe('Pelo Art. 20.2, não dá para reservar!\n\nOs valores:\n• Gourmet 01: 20%');
  });

  it('aceita JSON embrulhado em ```json', () => {
    const t = parse('```json\n{"reply":"Olá! Como posso ajudar?","next_stage":"","actions":[]}\n```');
    expect(t).toMatchObject({ reply: 'Olá! Como posso ajudar?', stageId: 'inicio', actions: [] });
  });

  it('muda só para um destino da etapa atual', () => {
    expect(parse({ reply: 'ok', next_stage: 'pedido' })?.stageId).toBe('pedido');
    const t = parse({ reply: 'ok', next_stage: 'pedido' }, pedido);
    expect(t?.stageId).toBe('pedido');
    const volta = parseAgentReply(JSON.stringify({ reply: 'ok', next_stage: 'inicio' }), { agent, stage: pedido, catalog });
    expect(volta?.stageId).toBe('pedido');
    expect(volta?.rejected[0]).toMatch(/não é um destino/);
  });

  it('recusa ferramenta fora da etapa e alvo não liberado', () => {
    const t = parse({ reply: 'x', actions: [{ tool: 'transfer_department', departmentId: 'dep-vendas' }, { tool: 'add_tag', tagId: 'tag-outra' }] });
    expect(t?.actions).toEqual([]);
    expect(t?.rejected).toHaveLength(2);
    const p = parse({ reply: 'x', actions: [{ tool: 'transfer_department', departmentId: 'dep-rh' }] }, pedido);
    expect(p?.actions).toEqual([]);
  });

  it('dado do contato antes; só a primeira ação que tira a conversa do agente vale', () => {
    const t = parse({
      reply: 'Vou te passar para Vendas.',
      actions: [
        { tool: 'transfer_department', departmentId: 'dep-vendas', reason: 'quer comprar' },
        { tool: 'close', closeReasonId: 'cr-ok' },
        { tool: 'set_contact_field', field: 'attribute:Convênio', value: 'Unimed' },
      ],
    }, pedido);
    expect(t?.actions.map((a) => a.tool)).toEqual(['set_contact_field', 'transfer_department']);
    expect(t?.rejected[0]).toMatch(/já saiu do agente/);
  });

  it('handoff funciona mesmo sem estar na etapa', () => {
    expect(parse({ reply: '', actions: [{ tool: 'handoff', reason: 'pediu humano' }] })?.actions).toEqual([{ tool: 'handoff', reason: 'pediu humano' }]);
  });

  it('texto puro vira resposta; JSON quebrado é falha', () => {
    expect(parse('Claro, posso ajudar!')).toMatchObject({ reply: 'Claro, posso ajudar!', actions: [] });
    expect(parse('{"reply": "oi", ')).toBeNull();
    expect(parse('')).toBeNull();
  });
});
