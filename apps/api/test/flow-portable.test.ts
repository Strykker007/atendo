import { describe, expect, it } from 'vitest';
import { copyName, hasWebhookBody, flowFromPortable, flowTagNames, flowToPortable, parsePortableFlow, restoreFlowDefinition, type FlowDefinition, type FlowTrigger } from '@atendo/shared';

const def = (nodes: unknown[]): FlowDefinition => ({ nodes, edges: [] } as unknown as FlowDefinition);
const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, data });
const flow = (definition: FlowDefinition, trigger: FlowTrigger = { type: 'manual' }) => ({ name: 'Boas-vindas', description: 'oi', trigger, definition });
/** Atalho dos testes: nomes do cliente de origem posicionais. */
const toPortable = (f: Parameters<typeof flowToPortable>[0], tagNameById: Record<string, string> = {}, flowNameById: Record<string, string> = {}) => flowToPortable(f, { tagNameById, flowNameById });

describe('toPortable — Conteúdo e Conectar', () => {
  it('remove os anexos das mensagens do Conteúdo (a chave carrega o tenant)', () => {
    const items = [{ id: 'a', kind: 'text', text: 'oi' }, { id: 'b', kind: 'image', mediaKey: 'media/t1/2026-10/x.png', mediaName: 'x.png', text: 'legenda' }];
    const { portable, warnings } = toPortable(flow(def([node('1', 'message', { items })])));
    const d = (portable.definition.nodes[0] as unknown as { data: { items: Record<string, unknown>[]; _reconfig?: string[] } }).data;
    expect(d.items[1].mediaKey).toBeUndefined();
    expect(d.items[1].text).toBe('legenda');
    expect(d._reconfig).toContain('anexo');
    expect(warnings.length).toBe(1);
  });
  it('troca o id do fluxo de destino pelo nome, só como referência', () => {
    const { portable } = toPortable(flow(def([node('1', 'connect_flow', { flowId: 'f2' })])), {}, { f2: 'Financeiro' });
    const d = (portable.definition.nodes[0] as { data: Record<string, unknown> }).data;
    expect(d.flowId).toBeUndefined();
    expect(d.flowName).toBe('Financeiro');
    expect(d._reconfig).toContain('fluxo de destino');
  });
});

describe('toPortable', () => {
  it('troca a etiqueta pelo nome, que é o que existe nos dois clientes', () => {
    const { portable, warnings } = toPortable(flow(def([node('1', 'action', { kind: 'add_tag', tagId: 't1', scope: 'contact' })])), { t1: 'VIP' });
    const d = (portable.definition.nodes[0] as { data: Record<string, unknown> }).data;
    expect(d.tagName).toBe('VIP');
    expect(d.tagId).toBeUndefined();
    expect(d.scope).toBe('contact'); // o que não é referência sobrevive
    expect(warnings).toEqual([]);
  });

  it('avisa quando a etiqueta já não existe', () => {
    const { portable, warnings } = toPortable(flow(def([node('1', 'condition', { kind: 'has_tag', tagId: 'sumiu' })])), {});
    expect((portable.definition.nodes[0] as { data: Record<string, unknown> }).data.tagName).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it('remove atendente, serviço e anexo, avisando cada um', () => {
    const { portable, warnings } = toPortable(
      flow(
        def([
          node('1', 'action', { kind: 'assign', agentId: 'u1' }),
          node('2', 'schedule', { serviceId: 's1', professionalId: 'p1', maxSlots: 3 }),
          node('3', 'message', { text: 'veja', mediaKey: 'media/tenant-a/x.png', mediaType: 'image', mediaName: 'x.png' }),
        ]),
      ),
      {},
    );
    const [n1, n2, n3] = portable.definition.nodes as unknown as { data: Record<string, unknown> }[];
    expect(n1.data.agentId).toBeUndefined();
    expect(n2.data.serviceId).toBeUndefined();
    expect(n2.data.maxSlots).toBe(3);
    // a chave de mídia carrega o tenant de origem: mantê-la serviria arquivo de outro cliente
    expect(n3.data.mediaKey).toBeUndefined();
    expect(n3.data.text).toBe('veja');
    expect(warnings).toHaveLength(3);
  });

  it('solta a restrição por número no gatilho', () => {
    const { portable, warnings } = toPortable(flow(def([]), { type: 'new_conversation', numberIds: ['n1'] }));
    expect(portable.trigger.numberIds).toBeUndefined();
    expect(portable.trigger.type).toBe('new_conversation');
    expect(warnings).toHaveLength(1);
  });

  it('não altera o fluxo original', () => {
    const original = flow(def([node('1', 'action', { kind: 'add_tag', tagId: 't1' })]));
    toPortable(original, { t1: 'VIP' });
    expect((original.definition.nodes[0] as unknown as { data: Record<string, unknown> }).data.tagId).toBe('t1');
  });

  it('repete o mesmo aviso uma vez só', () => {
    const { warnings } = toPortable(flow(def([node('1', 'action', { kind: 'assign', agentId: 'a' }), node('2', 'action', { kind: 'assign', agentId: 'b' })])), {});
    expect(warnings).toHaveLength(1);
  });
});

describe('flowTagNames', () => {
  it('lista os nomes sem repetir, para o destino criar o que falta', () => {
    const { portable } = toPortable(
      flow(def([node('1', 'action', { kind: 'add_tag', tagId: 'a' }), node('2', 'condition', { kind: 'has_tag', tagId: 'b' }), node('3', 'action', { kind: 'remove_tag', tagId: 'a' })])),
      { a: 'VIP', b: 'Orçamento' },
    );
    expect(flowTagNames(portable.definition).sort()).toEqual(['Orçamento', 'VIP']);
  });
});

describe('restoreFlowDefinition', () => {
  it('devolve o nome para id no cliente de destino', () => {
    const { portable } = toPortable(flow(def([node('1', 'action', { kind: 'add_tag', tagId: 'origem' })])), { origem: 'VIP' });
    const { definition, warnings } = restoreFlowDefinition(portable.definition, { VIP: 'destino' });
    expect((definition.nodes[0] as unknown as { data: Record<string, unknown> }).data.tagId).toBe('destino');
    expect(warnings).toEqual([]);
  });

  it('avisa e segue quando a etiqueta não pôde ser criada', () => {
    const { portable } = toPortable(flow(def([node('1', 'action', { kind: 'add_tag', tagId: 'origem' })])), { origem: 'VIP' });
    const { definition, warnings } = restoreFlowDefinition(portable.definition, {});
    const d = (definition.nodes[0] as unknown as { data: Record<string, unknown> }).data;
    expect(d.tagId).toBeUndefined();
    expect(d.tagName).toBeUndefined();
    expect(warnings[0]).toContain('VIP');
  });

  it('ida e volta no mesmo cliente preserva o fluxo', () => {
    const original = flow(def([node('1', 'message', { text: 'oi' }), node('2', 'action', { kind: 'add_tag', tagId: 't1' })]));
    const { portable } = toPortable(original, { t1: 'VIP' });
    const back = restoreFlowDefinition(portable.definition, { VIP: 't1' });
    expect(back.definition).toEqual(original.definition);
  });
});

describe('parsePortableFlow', () => {
  it('aceita o que o próprio export gerou', () => {
    const { portable } = toPortable(flow(def([node('1', 'message', { text: 'oi' })])));
    expect(parsePortableFlow(JSON.parse(JSON.stringify(portable)))).toMatchObject({ name: 'Boas-vindas' });
  });

  it.each([
    ['nulo', null],
    ['texto', 'nada disso'],
    ['outro arquivo', { atendo: 'contatos', version: 1 }],
    ['versão futura', { atendo: 'flow', version: 99, name: 'x', trigger: {}, definition: { nodes: [], edges: [] } }],
    ['sem nome', { atendo: 'flow', version: 1, name: '  ', trigger: {}, definition: { nodes: [], edges: [] } }],
    ['desenho corrompido', { atendo: 'flow', version: 1, name: 'x', trigger: {}, definition: { nodes: 'oi' } }],
    ['sem gatilho', { atendo: 'flow', version: 1, name: 'x', definition: { nodes: [], edges: [] } }],
  ])('recusa %s', (_, raw) => {
    expect(() => parsePortableFlow(raw)).toThrow();
  });
});

describe('copyName', () => {
  it('numera a partir da segunda cópia', () => {
    expect(copyName('Boas-vindas', [])).toBe('Boas-vindas (cópia)');
    expect(copyName('Boas-vindas', ['Boas-vindas (cópia)'])).toBe('Boas-vindas (cópia 2)');
    expect(copyName('Boas-vindas', ['Boas-vindas (cópia)', 'Boas-vindas (cópia 2)'])).toBe('Boas-vindas (cópia 3)');
  });

  it('respeita o limite de 80 caracteres do campo', () => {
    const name = copyName('x'.repeat(80), []);
    expect(name).toHaveLength(80);
    expect(name.endsWith(' (cópia)')).toBe(true);
  });
});

describe('importação (flowFromPortable)', () => {
  it('gera ids novos para todos os nós, inclusive o Início, e reescreve {{menu_<id>}}', () => {
    const d: FlowDefinition = {
      nodes: [node('start', 'start', {}), node('m1', 'menu', { text: 'Escolha', options: [{ id: 'o1', label: 'A' }], maxRetries: 1 }), node('c1', 'message', { text: 'Você: {{menu_m1}}' })],
      edges: [{ id: 'x', source: 'start', target: 'm1' }, { id: 'y', source: 'm1', sourceHandle: 'o1', target: 'c1' }],
    } as unknown as FlowDefinition;
    const { portable } = toPortable(flow(d));
    let i = 0;
    const out = flowFromPortable(portable, {}, (t) => `${t}-n${++i}`);
    expect(out.definition.nodes.map((n) => n.id)).toEqual(['start-n1', 'menu-n2', 'message-n3']);
    expect(out.definition.edges).toEqual([
      { id: 'e-start-n1-out-menu-n2', source: 'start-n1', sourceHandle: null, target: 'menu-n2' },
      { id: 'e-menu-n2-o1-message-n3', source: 'menu-n2', sourceHandle: 'o1', target: 'message-n3' },
    ]);
    expect((out.definition.nodes[2].data as { text: string }).text).toBe('Você: {{menu_menu-n2}}');
  });

  it('etiqueta sem correspondência marca o card para reconfigurar', () => {
    const { portable } = toPortable(flow(def([node('1', 'action', { kind: 'add_tag', tagId: 'origem' })])), { origem: 'VIP' });
    const { definition } = restoreFlowDefinition(portable.definition, {});
    expect((definition.nodes[0] as unknown as { data: Record<string, unknown> }).data._reconfig).toEqual(['etiqueta']);
  });

  it('webhook: headers de credencial saem inteiros; os demais ficam', () => {
    const headers = [
      { id: 'a', key: 'Authorization', value: 'Bearer s3cr3t' },
      { id: 'b', key: 'X-Api-Key', value: 'k' },
      { id: 'c', key: 'X-Access-Token', value: 't' },
      { id: 'd', key: 'client_secret', value: 's' },
      { id: 'e', key: 'X-Origem', value: 'atendo' },
    ];
    const { portable, warnings } = toPortable(flow(def([node('1', 'action', { kind: 'webhook', url: 'https://x.com', headers })])));
    const d = (portable.definition.nodes[0] as unknown as { data: Record<string, unknown> }).data;
    expect(d.headers).toEqual([{ id: 'e', key: 'X-Origem', value: 'atendo' }]);
    expect(d._reconfig).toEqual(['URL do webhook', 'headers do webhook']);
    expect(warnings.some((w) => w.includes('Headers'))).toBe(true);
  });

  it('webhook importado é marcado para revisar; corpo é detectado para o aviso de download', () => {
    const d0 = def([node('1', 'action', { kind: 'webhook', url: 'https://x.com', body: '{"k":"{{x}}"}' }), node('2', 'action', { kind: 'add_tag' })]);
    expect(hasWebhookBody(d0)).toBe(true);
    expect(hasWebhookBody(def([node('1', 'action', { kind: 'webhook', body: '  ' })]))).toBe(false);
    const { definition } = restoreFlowDefinition(d0, {});
    const [w, t] = definition.nodes as unknown as { data: Record<string, unknown> }[];
    expect(w.data._reconfig).toEqual(['revisar configuração']);
    expect(t.data._reconfig).toBeUndefined();
  });
});
