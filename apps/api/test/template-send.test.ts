import { describe, expect, it } from 'vitest';
import type { MessageTemplate } from '@atendo/shared';
import { buildTemplateSend } from '../src/modules/whatsapp/templates';

const base: MessageTemplate = { id: '1', name: 'pedido', language: 'pt_BR', category: 'utility', body: 'Oi {{1}}', headerParams: [], bodyParams: ['1'] };

describe('buildTemplateSend', () => {
  it('botão de link dinâmico e cupom viram componentes pela posição do botão', () => {
    const t: MessageTemplate = { ...base, dynamicButtons: [{ index: 1, kind: 'url', text: 'Rastrear', url: 'https://loja.com/r/{{1}}' }, { index: 2, kind: 'copy_code', text: 'Cupom' }] };
    const r = buildTemplateSend(t, { body: { 1: 'Ana' }, buttons: { 1: 'ABC\n123', 2: 'DESCONTO10' } });
    expect(r.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] },
      { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: 'ABC 123' }] },
      { type: 'button', sub_type: 'copy_code', index: '2', parameters: [{ type: 'coupon_code', coupon_code: 'DESCONTO10' }] },
    ]);
  });

  it('botão dinâmico sem valor recusa com o nome do botão', () => {
    const t: MessageTemplate = { ...base, dynamicButtons: [{ index: 0, kind: 'url', text: 'Rastrear', url: 'https://x/{{1}}' }] };
    expect(() => buildTemplateSend(t, { body: { 1: 'Ana' } })).toThrow('Rastrear');
  });

  it('cabeçalho de mídia exige o arquivo e devolve a mídia para o envio', () => {
    const t: MessageTemplate = { ...base, headerFormat: 'IMAGE' };
    expect(() => buildTemplateSend(t, { body: { 1: 'Ana' } })).toThrow('imagem');
    const r = buildTemplateSend(t, { body: { 1: 'Ana' }, headerMedia: { key: 'media/t1/a.png', name: 'a.png' } });
    expect(r.template.headerMedia).toBe('image');
    expect(r.media).toEqual({ key: 'media/t1/a.png', type: 'image', name: 'a.png' });
  });
});
