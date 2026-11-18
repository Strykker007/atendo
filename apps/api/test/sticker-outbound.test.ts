import { describe, expect, it } from 'vitest';
import { outboundMediaType } from '../src/modules/conversations/sticker';

// figurinha (.webp) anexada no painel sai como figurinha, não como foto
describe('outboundMediaType', () => {
  it('webp sem legenda vira figurinha', () => {
    expect(outboundMediaType('image', 'image/webp', undefined)).toBe('sticker');
    expect(outboundMediaType('image', 'IMAGE/WEBP', '   ')).toBe('sticker');
  });
  it('webp com legenda continua imagem (figurinha não tem texto)', () => {
    expect(outboundMediaType('image', 'image/webp', 'olha isso')).toBe('image');
  });
  it('outros formatos e tipos não mudam', () => {
    expect(outboundMediaType('image', 'image/jpeg', undefined)).toBe('image');
    expect(outboundMediaType('image', 'image/png', null)).toBe('image');
    expect(outboundMediaType('image', undefined, undefined)).toBe('image');
    expect(outboundMediaType('document', 'image/webp', undefined)).toBe('document');
    expect(outboundMediaType('text', undefined, 'oi')).toBe('text');
  });
});
