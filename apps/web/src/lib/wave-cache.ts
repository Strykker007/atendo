/**
 * Guarda a onda sonora já calculada, entre sessões.
 *
 * Decodificar o áudio é a parte cara: baixa o arquivo e processa o som inteiro. Sem guardar,
 * isso é refeito toda vez que a conversa é aberta — e numa conversa que o atendente abre dez
 * vezes por dia, é o mesmo trabalho dez vezes, por áudio.
 *
 * Cada onda vira **uma letra por barra** (0-9, o pico arredondado), então 42 barras ocupam 42
 * caracteres. Centenas de áudios cabem em poucos KB, o que é o que torna viável usar o
 * armazenamento do navegador em vez de inventar um banco no servidor.
 */

const PREFIXO = 'atendo:onda:';
const INDICE = 'atendo:onda:indice';
/** Teto de áudios guardados. Passando disso, os mais antigos saem. */
const MAX = 400;

export interface Onda {
  picos: number[];
  duracao: number;
}

/**
 * A URL é assinada e muda a cada carregamento (`?exp=…&sig=…`), então a chave é o caminho —
 * senão o mesmo áudio seria tratado como novo a cada abertura da conversa, que é justamente
 * o problema que isto resolve.
 */
export function chaveDe(url: string): string {
  try {
    return new URL(url, location.origin).pathname;
  } catch {
    return url;
  }
}

const seguro = <T>(fn: () => T, padrao: T): T => {
  // aba anônima, cota cheia ou site com dados bloqueados: a onda é enfeite, nunca pode
  // derrubar a mensagem
  try {
    return fn();
  } catch {
    return padrao;
  }
};

export function lerOnda(url: string): Onda | null {
  return seguro(() => {
    const bruto = localStorage.getItem(PREFIXO + chaveDe(url));
    if (!bruto) return null;
    const [dur, picos] = bruto.split('|');
    const d = Number(dur);
    if (!picos || !Number.isFinite(d)) return null;
    return { duracao: d, picos: [...picos].map((c) => Number(c) / 9) };
  }, null);
}

export function gravarOnda(url: string, onda: Onda): void {
  seguro(() => {
    const chave = PREFIXO + chaveDe(url);
    const picos = onda.picos.map((p) => Math.round(Math.min(1, Math.max(0, p)) * 9)).join('');
    localStorage.setItem(chave, `${Math.round(onda.duracao)}|${picos}`);

    // índice próprio em vez de varrer o localStorage: ele é compartilhado com o resto do
    // app e sair apagando por prefixo é como se perde dado de outra funcionalidade
    const indice = (localStorage.getItem(INDICE) ?? '').split(',').filter(Boolean).filter((c) => c !== chave);
    indice.push(chave);
    while (indice.length > MAX) localStorage.removeItem(indice.shift()!);
    localStorage.setItem(INDICE, indice.join(','));
    return null;
  }, null);
}
