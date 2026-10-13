import { describe, expect, it } from 'vitest';
import { DEFAULT_LOSS_REASONS } from '@atendo/shared';
import { parseTemplateContent, provisionedLossReasonColors } from '../src/modules/tenants/tenant-template';

describe('cores dos motivos no modelo', () => {
  it('guarda só cor válida de motivo que está na lista', () => {
    const c = parseTemplateContent({ lossReasons: ['Preço', 'Sem estoque'], lossReasonColors: { Preço: '#FF0000', Fantasma: '#00ff00' } });
    expect(c.lossReasonColors).toEqual({ Preço: '#ff0000' });
  });

  it('sem lista própria, vale para os motivos do catálogo', () => {
    const m = DEFAULT_LOSS_REASONS[0];
    const c = parseTemplateContent({ lossReasonColors: { [m]: '#123456' } });
    expect(provisionedLossReasonColors(c)).toEqual({ [m]: '#123456' });
  });

  it('recusa cor fora de #rrggbb', () => {
    expect(() => parseTemplateContent({ lossReasons: ['Preço'], lossReasonColors: { Preço: 'red' } })).toThrow();
  });

  it('modelo sem cores: cliente nasce sem cores', () => {
    expect(parseTemplateContent({}).lossReasonColors).toBeUndefined();
    expect(provisionedLossReasonColors(null)).toEqual({});
  });
});
