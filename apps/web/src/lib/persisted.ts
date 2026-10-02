'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Estado que sobrevive a trocar de aba, navegar e recarregar.
 *
 * Serve para preferência de tela — pasta aberta, aba escolhida, menu recolhido. Coisas que o
 * atendente ajusta uma vez e espera encontrar do jeito que deixou; refazer isso a cada
 * navegação é pequeno e irritante, e some justamente quando ele estava no meio de procurar
 * alguma coisa.
 *
 * Não serve para dado de verdade: isto é por navegador, não acompanha a pessoa.
 */
export function usePersistedState<T>(chave: string, inicial: T) {
  const [valor, setValor] = useState<T>(inicial);
  /**
   * Só grava depois que o usuário mexeu.
   *
   * Gravar a cada mudança de valor parece natural e está errado: na montagem o efeito de
   * escrita roda no mesmo ciclo do de leitura e ainda enxerga o valor inicial, apagando o que
   * acabou de ser recuperado. O resultado era a pasta reabrir fechada — o bug que isto deveria
   * resolver. Marcar a intenção do usuário separa os dois casos sem depender de ordem.
   */
  const tocado = useRef(false);

  // lê depois de montar, nunca no estado inicial: no servidor não existe localStorage, e ler
  // durante a renderização faria o HTML do servidor divergir do que o navegador desenha
  useEffect(() => {
    const salvo = ler<T>(chave);
    if (salvo !== null) setValor(salvo);
  }, [chave]);

  useEffect(() => {
    if (tocado.current) gravar(chave, valor);
  }, [chave, valor]);

  const definir = useCallback((v: T | ((anterior: T) => T)) => {
    tocado.current = true;
    setValor(v);
  }, []);

  return [valor, definir] as const;
}

const PREFIXO = 'atendo:pref:';

function ler<T>(chave: string): T | null {
  // aba anônima ou site com dados bloqueados: preferência é conforto, nunca pode quebrar a tela
  try {
    const bruto = localStorage.getItem(PREFIXO + chave);
    return bruto ? (JSON.parse(bruto) as T) : null;
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: unknown) {
  try {
    localStorage.setItem(PREFIXO + chave, JSON.stringify(valor));
  } catch {
    /* cota cheia ou armazenamento bloqueado */
  }
}
