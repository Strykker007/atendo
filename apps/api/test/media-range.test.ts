import { describe, expect, it } from 'vitest';
import { parseRange } from '../src/modules/media/media.controller';

const TOTAL = 1000;

describe('parseRange', () => {
  it('faixa comum do player', () => {
    expect(parseRange('bytes=0-499', TOTAL)).toEqual({ start: 0, end: 499 });
    expect(parseRange('bytes=500-999', TOTAL)).toEqual({ start: 500, end: 999 });
  });

  it('"do byte X até o fim" — é o que o player manda ao começar a tocar', () => {
    expect(parseRange('bytes=0-', TOTAL)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=200-', TOTAL)).toEqual({ start: 200, end: 999 });
  });

  it('sufixo: os últimos N bytes', () => {
    expect(parseRange('bytes=-300', TOTAL)).toEqual({ start: 700, end: 999 });
    // sufixo maior que o arquivo devolve o arquivo todo, não um início negativo
    expect(parseRange('bytes=-5000', TOTAL)).toEqual({ start: 0, end: 999 });
  });

  it('fim além do arquivo é cortado no último byte', () => {
    expect(parseRange('bytes=900-99999', TOTAL)).toEqual({ start: 900, end: 999 });
  });

  it.each([['bytes=1000-1500'], ['bytes=2000-'], ['bytes=500-100']])('fora do arquivo ou invertida → 416 (%s)', (h) => {
    expect(parseRange(h, TOTAL)).toBe('invalid');
  });

  it.each([[''], ['  '], ['bytes=-'], ['items=0-10'], ['bytes=abc-def'], ['bytes=0-10, 20-30']])('sem Range utilizável serve o arquivo inteiro (%s)', (h) => {
    expect(parseRange(h, TOTAL)).toBeNull();
  });

  it('arquivo vazio não tenta fatiar', () => {
    expect(parseRange('bytes=0-10', 0)).toBeNull();
  });

  it('o último byte é incluído — fim exclusivo cortaria o arquivo', () => {
    const r = parseRange('bytes=0-', TOTAL) as { start: number; end: number };
    expect(r.end - r.start + 1).toBe(TOTAL);
  });
});
