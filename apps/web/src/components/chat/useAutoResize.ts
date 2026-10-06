'use client';
import { useLayoutEffect, type RefObject } from 'react';

/**
 * Campo que cresce com o texto. A altura máxima vem do CSS (`max-h-*`): passou dela, o campo
 * para de crescer e rola por dentro — os botões em volta nunca são empurrados para fora.
 */
export function useAutoResize(ref: RefObject<HTMLTextAreaElement | null>) {
  // sem dependências de propósito: o campo remonta (troca de aba, fim da gravação) já com texto
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
    const max = parseFloat(getComputedStyle(el).maxHeight);
    el.style.overflowY = Number.isFinite(max) && el.scrollHeight > max ? 'auto' : 'hidden';
  });
}
