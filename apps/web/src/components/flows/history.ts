'use client';
import { useCallback, useEffect, useRef } from 'react';

/** Quantos estados o Desfazer guarda. Cada um é só referência ao estado (imutável), não cópia. */
export const HISTORY_LIMIT = 100;
/** Mudanças seguidas dentro deste intervalo viram um passo só (digitar um texto, empurrar um card). */
const SETTLE_MS = 400;

/**
 * Histórico do editor por fotos do estado: em vez de registrar cada ação (adicionar, ligar,
 * mover, editar…), guarda o estado inteiro quando ele assenta e muda de verdade — `key` é o
 * mesmo snapshot do "não salvo", então seleção, medidas e zoom não viram passo.
 *
 * `restore` aplica uma foto; como a chave volta a ser a da foto, ela não é gravada de novo.
 */
export function useHistory<T>(state: T, key: string, restore: (s: T) => void, paused = false) {
  const stack = useRef<{ key: string; state: T }[]>([{ key, state }]);
  const index = useRef(0);
  const latest = useRef({ key, state });
  latest.current = { key, state };
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /** Grava o estado atual se mudou desde a foto em que estamos (descarta o "refazer"). */
  const commit = useCallback(() => {
    clearTimeout(timer.current);
    const cur = latest.current;
    if (cur.key === stack.current[index.current].key) return;
    const s = stack.current.slice(0, index.current + 1);
    s.push(cur);
    if (s.length > HISTORY_LIMIT) s.splice(0, s.length - HISTORY_LIMIT);
    stack.current = s;
    index.current = s.length - 1;
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    // arrastando: só grava quando soltar (a posição final é o passo)
    if (!paused) timer.current = setTimeout(commit, SETTLE_MS);
    return () => clearTimeout(timer.current);
  }, [key, paused, commit]);

  const undo = useCallback(() => {
    commit(); // o que acabou de ser digitado também se desfaz
    if (index.current === 0) return false;
    index.current -= 1;
    restore(stack.current[index.current].state);
    return true;
  }, [commit, restore]);

  const redo = useCallback(() => {
    commit();
    if (index.current >= stack.current.length - 1) return false;
    index.current += 1;
    restore(stack.current[index.current].state);
    return true;
  }, [commit, restore]);

  return { undo, redo };
}
