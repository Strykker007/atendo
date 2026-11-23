import { describe, expect, it } from 'vitest';
import { dedupeStickers, outboundMediaType } from '../src/modules/conversations/sticker';

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

describe('dedupeStickers', () => {
  const sha = (n: number) => ({ message: { stickerMessage: { fileSha256: { 0: n, 1: 7 } } } });
  it('a mesma figurinha recebida várias vezes aparece uma vez só (mais recente)', () => {
    const r = dedupeStickers([
      { id: 'a', mediaUrl: 'media/t/1.webp', raw: sha(1) },
      { id: 'b', mediaUrl: 'media/t/2.webp', raw: sha(1) },
      { id: 'c', mediaUrl: 'media/t/3.webp', raw: sha(2) },
    ], 10);
    expect(r.map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('sem sha (enviada pelo painel) usa a chave do arquivo', () => {
    const r = dedupeStickers([
      { id: 'a', mediaUrl: 'media/t/x.webp', raw: null },
      { id: 'b', mediaUrl: 'media/t/x.webp', raw: { simulateTypingChars: 0 } },
      { id: 'c', mediaUrl: 'media/t/y.webp', raw: null },
    ], 10);
    expect(r.map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('respeita o limite', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: String(i), mediaUrl: `media/t/${i}.webp`, raw: null }));
    expect(dedupeStickers(rows, 3)).toHaveLength(3);
    expect(dedupeStickers([], 3)).toEqual([]);
  });
});
