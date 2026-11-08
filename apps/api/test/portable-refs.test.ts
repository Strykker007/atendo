import { describe, expect, it } from 'vitest';
import { flowRefNames, parsePortableAiAgentFile, parsePortableTicketTypeFile, restoreFlowDefinition, scrubFlowDefinition, type FlowDefinition } from '@atendo/shared';
import { parseTemplateContent } from '../src/modules/tenants/tenant-template';

const def = (data: Record<string, unknown>[]): FlowDefinition => ({ nodes: data.map((d, i) => ({ id: `n${i}`, type: i === 0 ? 'ai' : 'action', position: { x: 0, y: 0 }, data: d })), edges: [] } as unknown as FlowDefinition);

describe('agente de IA e tipo de ticket viajam pelo nome', () => {
  const origem = def([{ mode: 'agent', aiAgentId: 'ag-1' }, { kind: 'create_ticket', ticketTypeId: 'tt-1', ticketTitle: 'Vazamento' }]);
  it('exportar troca id por nome', () => {
    const { definition } = scrubFlowDefinition(origem, { aiAgentNameById: { 'ag-1': 'Ana' }, ticketTypeNameById: { 'tt-1': 'Manutenção' } });
    expect(definition.nodes[0].data).toMatchObject({ aiAgentName: 'Ana' });
    expect(definition.nodes[0].data).not.toHaveProperty('aiAgentId');
    expect(definition.nodes[1].data).toMatchObject({ ticketTypeName: 'Manutenção' });
    expect(flowRefNames(definition)).toEqual({ aiAgents: ['Ana'], ticketTypes: ['Manutenção'] });
  });
  it('importar resolve pelo nome (ignorando maiúsculas) no destino', () => {
    const { definition: portavel } = scrubFlowDefinition(origem, { aiAgentNameById: { 'ag-1': 'Ana' }, ticketTypeNameById: { 'tt-1': 'Manutenção' } });
    const { definition, warnings } = restoreFlowDefinition(portavel, {}, { aiAgentIdByName: { ana: 'novo-ag' }, ticketTypeIdByName: { 'Manutenção': 'novo-tt' } });
    expect(definition.nodes[0].data).toMatchObject({ aiAgentId: 'novo-ag' });
    expect(definition.nodes[1].data).toMatchObject({ ticketTypeId: 'novo-tt' });
    expect(warnings).toEqual([]);
  });
  it('sem o agente no destino: sai do bloco e marca para reconfigurar', () => {
    const { definition: portavel } = scrubFlowDefinition(origem, { aiAgentNameById: { 'ag-1': 'Ana' } });
    const { definition, warnings } = restoreFlowDefinition(portavel, {});
    expect(definition.nodes[0].data).not.toHaveProperty('aiAgentId');
    expect((definition.nodes[0].data as { _reconfig?: string[] })._reconfig).toContain('agente de IA');
    expect(warnings.some((w) => w.includes('"Ana"'))).toBe(true);
  });
});

describe('arquivos portáveis', () => {
  it('agente: tom inválido vira padrão; sem etapas recusa', () => {
    const [a] = parsePortableAiAgentFile({ atendo: 'ai-agent', version: 1, name: 'Ana', tone: 'x', stages: [{ id: 'a', name: 'A', goal: 'g', tools: [], transitions: [] }], targets: { tagNames: ['VIP', 'VIP'] } });
    expect(a.tone).toBe('friendly');
    expect(a.targets.tagNames).toEqual(['VIP']);
    expect(() => parsePortableAiAgentFile({ atendo: 'ai-agent', version: 1, name: 'X', stages: [] })).toThrow(/etapas/);
  });
  it('tipo de ticket: campos limpos, cor e prioridade com padrão', () => {
    const [t] = parsePortableTicketTypeFile({ atendo: 'ticket-type-bundle', version: 1, items: [{ atendo: 'ticket-type', version: 1, name: 'Encomenda', color: 'azul', priority: 'zz', fields: [{ label: 'Produto', required: true }] }] });
    expect(t).toMatchObject({ color: '#6366f1', priority: 'normal', dueDays: null });
    expect(t.fields[0]).toMatchObject({ key: 'produto', required: true });
  });
});

describe('modelo de perfil com agentes e tipos', () => {
  it('aceita e mantém; agente repetido recusa', () => {
    const agente = { atendo: 'ai-agent', version: 1, name: 'Ana', stages: [{ id: 'a', name: 'A', goal: 'g', tools: [], transitions: [] }] };
    const c = parseTemplateContent({ profiles: [], quickReplies: [], flows: [], aiAgents: [agente], ticketTypes: [{ atendo: 'ticket-type', version: 1, name: 'Entrega' }] });
    expect(c.aiAgents?.[0].name).toBe('Ana');
    expect(c.ticketTypes?.[0].name).toBe('Entrega');
    expect(() => parseTemplateContent({ profiles: [], quickReplies: [], flows: [], aiAgents: [agente, { ...agente, name: 'ana' }] })).toThrow(/mesmo nome/);
  });
});
