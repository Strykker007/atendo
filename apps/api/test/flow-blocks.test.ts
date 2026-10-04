import { describe, expect, it } from 'vitest';
import { cloneFlowFragment, type FlowEdge, type FlowNode } from '@atendo/shared';
import { leastBusy, nextInRotation, pickWeighted } from '../src/modules/flows/distribution';
import { isPrivateAddress } from '../src/modules/flows/webhook';
import { nextOpenFrom, type ScheduleSource } from '../src/modules/tenants/schedule-clock';
import { defaultScheduleConfig } from '@atendo/shared';
import { flowToPortable as toPortable, parsePortableFlowFile as parsePortableFile, toBundle } from '@atendo/shared';
import { parsePortableReplyFile, toPortableReply, toReplyBundle } from '../src/modules/quick-replies/portable';

const n = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as FlowNode;

describe('Distribuidor', () => {
  it('rodízio passa para o próximo e volta ao início', () => {
    expect(nextInRotation(['b', 'a', 'c'], null)).toBe('a');
    expect(nextInRotation(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextInRotation(['a', 'b', 'c'], 'c')).toBe('a');
    // quem recebeu por último saiu da lista: recomeça
    expect(nextInRotation(['a', 'b'], 'z')).toBe('a');
    expect(nextInRotation([], 'a')).toBeUndefined();
  });
  it('menos ocupado escolhe quem tem menos conversas abertas', () => {
    expect(leastBusy(['a', 'b', 'c'], { a: 3, b: 1, c: 2 })).toBe('b');
    expect(leastBusy(['a', 'b'], {})).toBe('a');
  });
});

describe('Randomizador', () => {
  const ramos = [{ id: 'a', weight: 30 }, { id: 'b', weight: 70 }, { id: 'z', weight: 0 }];
  it('sorteia pelo peso e nunca escolhe peso zero', () => {
    expect(pickWeighted(ramos, () => 0)?.id).toBe('a');
    expect(pickWeighted(ramos, () => 0.29)?.id).toBe('a');
    expect(pickWeighted(ramos, () => 0.31)?.id).toBe('b');
    expect(pickWeighted(ramos, () => 0.9999)?.id).toBe('b');
  });
  it('sem peso nenhum não escolhe', () => expect(pickWeighted([{ weight: 0 }])).toBeUndefined());
});

describe('webhook', () => {
  it('reconhece endereços internos', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.10', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '100.64.0.1']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('Atraso inteligente', () => {
  // seg–sex 08:00–18:00
  const src = (attendanceActive = true): ScheduleSource => ({ timezone: 'America/Sao_Paulo', config: defaultScheduleConfig(), attendanceActive });
  it('fora do expediente empurra para a próxima abertura', () => {
    // sexta 2026-10-02 22:00 em São Paulo (UTC-3) = 2026-10-03T01:00Z → segunda 08:00 = 11:00Z
    const r = nextOpenFrom(src(), new Date('2026-10-03T01:00:00Z'));
    expect(r.toISOString()).toBe('2026-10-05T11:00:00.000Z');
  });
  it('dentro do expediente não muda', () => {
    const from = new Date('2026-10-05T15:00:00Z');
    expect(nextOpenFrom(src(), from)).toBe(from);
  });
  it('atendimento desligado não prende o fluxo', () => {
    const from = new Date('2026-10-03T01:00:00Z');
    expect(nextOpenFrom(src(false), from)).toBe(from);
  });
});

describe('colar cards', () => {
  const nodes = [n('start', 'start'), n('m1', 'menu', { text: 'oi', options: [{ id: 'o1', label: 'A' }] }), n('t1', 'message', { text: 'Você escolheu {{menu_m1}}' }), n('fora', 'message', { text: 'x' })];
  const edges: FlowEdge[] = [
    { id: 'e1', source: 'start', target: 'm1' },
    { id: 'e2', source: 'm1', sourceHandle: 'o1', target: 't1' },
    { id: 'e3', source: 't1', target: 'fora' },
  ];
  it('gera ids novos, mantém só as ligações internas e reescreve {{menu_<id>}}', () => {
    let i = 0;
    const frag = cloneFlowFragment(nodes.slice(0, 3), edges, { newId: (t) => `${t}-new${++i}`, offset: { x: 10, y: 20 } });
    expect(frag.nodes.map((x) => x.id)).toEqual(['menu-new1', 'message-new2']); // Início nunca é copiado
    expect(frag.edges).toEqual([{ id: 'e-menu-new1-o1-message-new2', source: 'menu-new1', sourceHandle: 'o1', target: 'message-new2' }]);
    expect((frag.nodes[1].data as { text: string }).text).toBe('Você escolheu {{menu_menu-new1}}');
    expect(frag.nodes[0].position).toEqual({ x: 10, y: 20 });
  });
});

describe('exportação em lote', () => {
  const flow = { name: 'F', trigger: { type: 'manual' as const }, definition: { nodes: [n('start', 'start'), n('a', 'action', { kind: 'webhook', url: 'https://x.com/h?token=s3cr3t' }), n('d', 'distributor', { mode: 'round_robin', agentIds: ['u1'] })], edges: [] } };
  it('não leva URL de webhook nem atendentes, e marca o card para reconfigurar', () => {
    const { portable } = toPortable(flow);
    const [, a, d] = portable.definition.nodes as unknown as { data: Record<string, unknown> }[];
    expect(a.data.url).toBeUndefined();
    expect(a.data._reconfig).toEqual(['URL do webhook']);
    expect(d.data.agentIds).toBeUndefined();
    expect(d.data._reconfig).toEqual(['atendentes']);
  });
  it('importação aceita o arquivo individual e o lote', () => {
    const { portable } = toPortable(flow);
    expect(parsePortableFile(portable)).toHaveLength(1);
    expect(parsePortableFile(toBundle('flow', [portable, portable]))).toHaveLength(2);
    expect(() => parsePortableFile({ atendo: 'flow-bundle', version: 1, items: [portable, { atendo: 'x' }] })).toThrow(/Fluxo 2/);
  });
  it('respostas rápidas: anexo não viaja, lote e individual são aceitos', () => {
    const { portable, warnings } = toPortableReply({ title: 'Oi', body: 'Olá {{contact.name}}', mediaKey: 'media/t1/a.png' }, 'Saudações');
    expect(portable).toEqual({ atendo: 'quick-reply', version: 1, folder: 'Saudações', title: 'Oi', body: 'Olá {{contact.name}}' });
    expect(warnings).toHaveLength(1);
    expect(parsePortableReplyFile(portable)).toHaveLength(1);
    expect(parsePortableReplyFile(toReplyBundle([portable, portable]))).toHaveLength(2);
    expect(() => parsePortableReplyFile({ atendo: 'flow' })).toThrow();
  });
});
