/**
 * Variações de texto nas mensagens automáticas: `{Oi|Olá|Bom dia}` vira uma das opções, sorteada
 * a cada envio. Texto idêntico para dezenas de contatos é o padrão de robô que o WhatsApp pune
 * no número não oficial (docs/envio.md#variações-de-texto).
 *
 * Só chaves simples com pelo menos um `|` e sem chave aninhada — `{{nome}}` (variável) e
 * `{texto}` sem barra ficam intactos.
 */
const SPIN = /(?<!\{)\{([^{}|]*(?:\|[^{}|]*)+)\}(?!\})/g;

export function spin(text: string, random: () => number = Math.random): string {
  return text.replace(SPIN, (_, body: string) => {
    const opts = body.split('|');
    return opts[Math.floor(random() * opts.length)] ?? '';
  });
}
