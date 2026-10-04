import { describe, expect, it } from 'vitest';
import { contentMediaError, normalizeContent, type FlowDefinition } from '@atendo/shared';
import { assertOwnFlowMedia, validateDefinition } from '../src/modules/flows/flow-validation';

const start = { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} };
const def = (data: Record<string, unknown>, type = 'message'): FlowDefinition =>
  ({ nodes: [start, { id: 'm', type, position: { x: 0, y: 0 }, data }], edges: [{ id: 'e', source: 's', target: 'm' }] }) as unknown as FlowDefinition;

describe('Conteúdo — formato antigo', () => {
  it('texto solto vira uma mensagem de texto', () => {
    expect(normalizeContent({ text: 'Olá' })).toEqual([{ id: 'legacy', kind: 'text', text: 'Olá' }]);
  });
  it('anexo + texto vira um item com legenda — exatamente o que era enviado', () => {
    expect(normalizeContent({ text: 'Tabela', mediaKey: 'media/t/x.pdf', mediaType: 'document', mediaName: 'x.pdf' }))
      .toEqual([{ id: 'legacy', kind: 'document', mediaKey: 'media/t/x.pdf', mediaName: 'x.pdf', text: 'Tabela' }]);
  });
  it('áudio não tem legenda: o texto vira a mensagem seguinte', () => {
    const items = normalizeContent({ text: 'Ouça', mediaKey: 'media/t/a.ogg', mediaType: 'audio' });
    expect(items.map((i) => i.kind)).toEqual(['audio', 'text']);
  });
  it('bloco antigo salvo continua passando na validação', () => {
    expect(() => validateDefinition(def({ text: 'oi', mediaKey: 'media/t/x.png', mediaType: 'image' }))).not.toThrow();
  });
});

describe('Conteúdo — validação', () => {
  it('recusa formato e tamanho fora do limite do WhatsApp', () => {
    expect(contentMediaError('image', 'image/gif')).toMatch(/formato/);
    expect(contentMediaError('image', 'image/png', 6 * 1024 * 1024)).toMatch(/5 MB/);
    expect(contentMediaError('document', 'application/pdf', 50 * 1024 * 1024)).toBeNull();
  });
  it('mensagem vazia, arquivo faltando e intervalo fora da faixa não salvam', () => {
    expect(() => validateDefinition(def({ items: [{ id: 'a', kind: 'text', text: ' ' }] }))).toThrow(/texto está vazio/);
    expect(() => validateDefinition(def({ items: [{ id: 'a', kind: 'image' }] }))).toThrow(/envie o arquivo/);
    expect(() => validateDefinition(def({ items: [{ id: 'a', kind: 'text', text: 'a' }, { id: 'b', kind: 'text', text: 'b', delay: 999 }] }))).toThrow(/intervalo/);
  });
  it('anexo de outro cliente é recusado', () => {
    expect(() => assertOwnFlowMedia('t1', def({ items: [{ id: 'a', kind: 'image', mediaKey: 'media/t2/x.png' }] }))).toThrow();
    expect(() => assertOwnFlowMedia('t1', def({ items: [{ id: 'a', kind: 'image', mediaKey: 'media/t1/x.png' }] }))).not.toThrow();
  });
});

describe('Conectar com outro fluxo — validação', () => {
  it('precisa do destino, exceto quando veio de outro cliente (card mostra Reconfigurar)', () => {
    expect(() => validateDefinition(def({}, 'connect_flow'))).toThrow(/destino/);
    expect(() => validateDefinition(def({ _reconfig: ['fluxo de destino'] }, 'connect_flow'))).not.toThrow();
  });
});
