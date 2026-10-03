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
