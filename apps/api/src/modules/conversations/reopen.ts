/**
 * Uma conversa por pessoa, vários atendimentos dentro dela.
 *
 * Antes, encerrar um atendimento e receber uma mensagem nova criava **outra conversa**: o
 * mesmo contato aparecia duas vezes na tela, uma em "encerrado" e outra em "aguardando", com
 * o histórico partido entre as duas. No WhatsApp (e na cabeça de quem atende) a conversa com
 * uma pessoa é uma só — o que começa e termina é o *atendimento*.
 *
 * Isolado por isto decidir, para cada mensagem recebida, se a pessoa está voltando a um
 * atendimento em andamento ou abrindo um novo. Errar aqui significa misturar atendimentos ou
 * continuar partindo o histórico.
 */

export type StatusConversa = 'waiting' | 'in_progress' | 'closed';

export interface ConversaExistente {
  id: string;
  status: StatusConversa;
}

export type DecisaoEntrada =
  /** não há conversa com esta pessoa neste número: cria */
  | { acao: 'criar' }
  /** conversa em andamento: a mensagem entra nela, nada muda de status */
  | { acao: 'usar'; id: string }
  /** estava encerrada: a MESMA conversa volta para a fila e começa um atendimento novo */
  | { acao: 'reabrir'; id: string };

export function decidirEntrada(existente: ConversaExistente | null | undefined): DecisaoEntrada {
  if (!existente) return { acao: 'criar' };
  return existente.status === 'closed' ? { acao: 'reabrir', id: existente.id } : { acao: 'usar', id: existente.id };
}

/**
 * O contato está voltando depois de um atendimento encerrado?
 *
 * É o que dispara o fluxo "conversa finalizada". Vale tanto para a conversa reaberta quanto
 * para o caso antigo (conversa nova depois de uma encerrada), porque bases criadas antes
 * desta mudança ainda têm o histórico partido.
 */
export function voltandoDepoisDeEncerrado(decisao: DecisaoEntrada, statusAnterior?: StatusConversa | null): boolean {
  if (decisao.acao === 'reabrir') return true;
  return decisao.acao === 'criar' && statusAnterior === 'closed';
}

// ---------------------------------------------------------------------------

/**
 * Carência depois de encerrar. Na prática o encerramento vem junto com a despedida ("qualquer
 * coisa estamos à disposição") e o cliente responde "ok", "obrigada", uma figurinha — e isso
 * reabria a conversa como atendimento novo na fila: o atendente encerrava e ela "voltava para
 * aguardando". Em produção (out/2026) eram ~1 em 20 encerramentos reabrindo em menos de 1 min.
 *
 * Dentro da carência, CONFIRMAÇÃO do cliente e mensagem da loja pelo celular entram no
 * histórico da conversa encerrada sem reabri-la. Pergunta de verdade ("quanto tempo pra
 * entrega?"), áudio, foto e documento reabrem como sempre — engolir um pedido é pior que
 * reabrir um "ok".
 */
export const CLOSE_GRACE_MS = 2 * 60 * 60_000;

/** Ainda está na carência do encerramento? */
export function naCarencia(closedAt: Date | null | undefined, at: Date): boolean {
  return !!closedAt && at.getTime() - closedAt.getTime() >= -5_000 && at.getTime() - closedAt.getTime() < CLOSE_GRACE_MS;
}

/**
 * Palavras de confirmação/agradecimento. Deliberadamente sem "oi", "bom dia" (abrem conversa)
 * e sem "sim"/"não" (respondem pergunta — inclusive a pesquisa do fluxo de encerramento).
 */
const CONFIRMACOES = new Set([
  'ok', 'okay', 'okk', 'oks', 'blz', 'beleza', 'certo', 'certinho', 'ta', 'tabom', 'ta bom', 'tudo bem', 'tudo certo', 'combinado', 'perfeito', 'show', 'top', 'otimo', 'entendi', 'entendido', 'joia', 'valeu', 'vlw', 'falou', 'fechado',
  'obrigado', 'obrigada', 'obrigadu', 'obg', 'obgd', 'obgda', 'brigado', 'brigada', 'agradeco', 'grato', 'grata', 'muito obrigado', 'muito obrigada', 'mt obrigado', 'mt obrigada', 'obrigado viu', 'obrigada viu',
  'de nada', 'por nada', 'eu que agradeco', 'eu quem agradeco', 'nos que agradecemos', 'igualmente', 'pra voce tambem', 'para voce tambem', 'vc tambem', 'voce tambem', 'amem', 'deus abencoe',
]);

/**
 * A mensagem é só uma confirmação ("ok", "obrigada 😊", "ok, obrigado!", 👍, figurinha)?
 * Estrita: até 6 palavras, e todas as partes têm que ser confirmação — "ok, e a entrega?" não é.
 */
export function ehConfirmacao(m: { type: string; text?: string | null }): boolean {
  if (m.type === 'sticker' || m.type === 'reaction') return true;
  if (m.type !== 'text') return false;
  const limpo = (m.text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // emoji e pontuação viram separador
    .replace(/[\p{Extended_Pictographic}‍️]/gu, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // só emoji ("👍", "🙏🏼"); número ou pontuação solta ("1", "?") não — responde pergunta/pesquisa
  if (!limpo) return /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f\s]+$/u.test(m.text?.trim() ?? '') && !!m.text?.trim();
  if (limpo.split(' ').length > 6) return false;
  if (CONFIRMACOES.has(limpo)) return true;
  // "ok obrigada", "certo muito obrigado", "obrigada pra voce tambem": cada pedaço é confirmação
  const palavras = limpo.split(' ');
  let i = 0;
  while (i < palavras.length) {
    let casou = 0;
    for (let n = Math.min(4, palavras.length - i); n >= 1; n--) {
      if (CONFIRMACOES.has(palavras.slice(i, i + n).join(' '))) { casou = n; break; }
    }
    if (!casou) return false;
    i += casou;
  }
  return true;
}
