import { describe, expect, it } from 'vitest';
import type { FlowDefinition, FlowTrigger } from '@atendo/shared';
import { copyName, fromPortable, parsePortable, tagNamesOf, toPortable } from '../src/modules/flows/portable';

const def = (nodes: unknown[]): FlowDefinition => ({ nodes, edges: [] } as unknown as FlowDefinition);
const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, data });
const flow = (definition: FlowDefinition, trigger: FlowTrigger = { type: 'manual' }) => ({ name: 'Boas-vindas', description: 'oi', trigger, definition });

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

describe('tagNamesOf', () => {
  it('lista os nomes sem repetir, para o destino criar o que falta', () => {
    const { portable } = toPortable(
      flow(def([node('1', 'action', { kind: 'add_tag', tagId: 'a' }), node('2', 'condition', { kind: 'has_tag', tagId: 'b' }), node('3', 'action', { kind: 'remove_tag', tagId: 'a' })])),
      { a: 'VIP', b: 'Orçamento' },
    );
    expect(tagNamesOf(portable).sort()).toEqual(['Orçamento', 'VIP']);
  });
});

describe('fromPortable', () => {
  it('devolve o nome para id no cliente de destino', () => {
    const { portable } = toPortable(flow(def([node('1', 'action', { kind: 'add_tag', tagId: 'origem' })])), { origem: 'VIP' });
    const { definition, warnings } = fromPortable(portable, { VIP: 'destino' });
    expect((definition.nodes[0] as unknown as { data: Record<string, unknown> }).data.tagId).toBe('destino');
    expect(warnings).toEqual([]);
  });

  it('avisa e segue quando a etiqueta não pôde ser criada', () => {
    const { portable } = toPortable(flow(def([node('1', 'action', { kind: 'add_tag', tagId: 'origem' })])), { origem: 'VIP' });
    const { definition, warnings } = fromPortable(portable, {});
    const d = (definition.nodes[0] as unknown as { data: Record<string, unknown> }).data;
    expect(d.tagId).toBeUndefined();
    expect(d.tagName).toBeUndefined();
    expect(warnings[0]).toContain('VIP');
  });

  it('ida e volta no mesmo cliente preserva o fluxo', () => {
    const original = flow(def([node('1', 'message', { text: 'oi' }), node('2', 'action', { kind: 'add_tag', tagId: 't1' })]));
    const { portable } = toPortable(original, { t1: 'VIP' });
    const back = fromPortable(portable, { VIP: 't1' });
    expect(back.definition).toEqual(original.definition);
    expect(back.name).toBe('Boas-vindas');
  });
});

describe('parsePortable', () => {
  it('aceita o que o próprio export gerou', () => {
    const { portable } = toPortable(flow(def([node('1', 'message', { text: 'oi' })])));
    expect(parsePortable(JSON.parse(JSON.stringify(portable)))).toMatchObject({ name: 'Boas-vindas' });
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
    expect(() => parsePortable(raw)).toThrow();
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
