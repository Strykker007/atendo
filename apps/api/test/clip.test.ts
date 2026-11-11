import { describe, expect, it } from 'vitest';
import { clip } from '../src/common/clip';

describe('clip', () => {
  it('não mexe no que cabe', () => expect(clip('oi', 120)).toBe('oi'));
  it('corta texto comum', () => expect(clip('abcdef', 3)).toBe('abc'));
  it('não parte emoji no meio', () => {
    const s = `${'a'.repeat(119)}😀fim`;
    const r = clip(s, 120);
    expect(r).toBe('a'.repeat(119));
    expect(() => encodeURIComponent(r)).not.toThrow();
  });
  it('mantém emoji inteiro que cabe', () => expect(clip(`${'a'.repeat(118)}😀fim`, 120)).toBe(`${'a'.repeat(118)}😀`));
});
