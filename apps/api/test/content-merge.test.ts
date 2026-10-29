import { describe, expect, it } from 'vitest';
import type { ContentItem } from '@atendo/shared';
import { mergedItem, quickTextRun } from '../src/modules/flows/content-merge';

const t = (text: string, delay = 0): ContentItem => ({ id: text, kind: 'text', text, delay });

describe('quickTextRun / mergedItem', () => {
  it('boas-vindas: dois textos a 2 s viram uma mensagem, na mesma ordem', () => {
    const items = [t('Boa noite!'), t('Em instantes um atendente fala com você.', 2)];
    expect(quickTextRun(items, 0)).toBe(2);
    expect(mergedItem(items, 0, 2).text).toBe('Boa noite!\n\nEm instantes um atendente fala com você.');
  });

  it('pausa maior que 3 s, mídia ou texto vazio cortam a sequência', () => {
    expect(quickTextRun([t('a'), t('b', 10)], 0)).toBe(1);
    expect(quickTextRun([t('a'), { id: 'img', kind: 'image', mediaKey: 'k' }, t('c')], 0)).toBe(1);
    expect(quickTextRun([t('a'), t('  ')], 0)).toBe(1);
    expect(quickTextRun([t('a'), t('b', 1), t('c', 3), t('d', 4)], 0)).toBe(3);
  });

  it('começando numa mídia: sai sozinha', () => {
    expect(quickTextRun([{ id: 'img', kind: 'image', mediaKey: 'k' }, t('b')], 0)).toBe(1);
  });
});
