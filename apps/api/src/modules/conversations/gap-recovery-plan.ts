import { ehConfirmacao, naCarencia, type StatusConversa } from './reopen';

/**
 * Recuperação de mensagens que o número não recebeu ao vivo (docs/historico-de-mensagens.md#recuperação):
 * o que muda na conversa quando as recuperadas entram.
 *
 * "Histórico + alerta": a mensagem sempre entra no lugar certo do histórico, mas a conversa só se
 * mexe se a recuperada for MAIS NOVA que tudo o que ela já tem — uma das 13:20 numa conversa que
 * já falou às 13:40 não pode trazer a prévia de volta nem reabrir um atendimento encerrado depois.
 * Cliente esperando resposta no fim da linha: volta para a fila como não lida. Nada de fluxo.
 */
export interface ConversaAtual {
  status: StatusConversa;
  closedAt: Date | null;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  awaitingSince: Date | null;
}

export interface Recuperada {
  fromMe?: boolean;
  timestamp: Date;
  type: string;
  text?: string | null;
}

export interface PlanoDaRecuperacao {
  /** status a aplicar; numa conversa nova, sempre preenchido */
  status?: StatusConversa;
  /** índice (em `msgs`) da que vira prévia e `lastMessageAt`; ausente = nada mais novo que a conversa */
  ultima?: number;
  lastInboundAt?: Date;
  unreadIncrement: number;
  /** `undefined` = não mexe; `null` = a espera acabou (respondida pelo celular) */
  awaitingSince?: Date | null;
}

/** `msgs` em ordem cronológica. `isento`: chat livre (contato isento ou grupo) — nunca fila nem espera. */
export function planoDaRecuperacao(conv: ConversaAtual | null, isento: boolean, msgs: Recuperada[]): PlanoDaRecuperacao {
  const plano: PlanoDaRecuperacao = { unreadIncrement: 0 };
  const corte = conv?.lastMessageAt?.getTime() ?? -Infinity;

  const recebidas = msgs.filter((m) => !m.fromMe);
  const ultimaRecebida = recebidas.at(-1);
  if (ultimaRecebida && (!conv?.lastInboundAt || ultimaRecebida.timestamp > conv.lastInboundAt)) plano.lastInboundAt = ultimaRecebida.timestamp;

  const inicio = msgs.findIndex((m) => m.timestamp.getTime() > corte);
  if (inicio < 0) return plano; // todas no meio do histórico: só entram, a conversa fica como está
  const novas = msgs.slice(inicio);
  plano.ultima = msgs.length - 1;

  // o que ficou sem resposta no fim: recebidas depois da última enviada (nossa ou pelo celular)
  let ultimaEnviada = -1;
  novas.forEach((m, i) => { if (m.fromMe) ultimaEnviada = i; });
  const semResposta = novas.slice(ultimaEnviada + 1);

  if (isento) {
    if (!conv || conv.status !== 'in_progress') plano.status = 'in_progress';
    if (semResposta.length) plano.unreadIncrement = semResposta.length;
    return plano;
  }

  if (semResposta.length) {
    plano.unreadIncrement = semResposta.length;
    // respondida no meio do lote: a espera recomeça na primeira sem resposta
    plano.awaitingSince = ultimaEnviada >= 0 ? semResposta[0].timestamp : conv?.awaitingSince ?? semResposta[0].timestamp;
    if (!conv) plano.status = 'waiting';
    else if (conv.status === 'closed') {
      // mesma carência da entrada ao vivo (reopen.ts): "ok"/"obrigada" logo depois de encerrar não reabre
      const quieta = naCarencia(conv.closedAt, semResposta[0].timestamp) && semResposta.every((m) => ehConfirmacao(m));
      if (!quieta) plano.status = 'waiting';
    }
    return plano;
  }

  // a última é nossa (respondida pelo celular): a espera acabou; encerrada volta como "em atendimento",
  // igual à mensagem digitada no celular ao vivo (InboundService.ingestFromDevice)
  plano.awaitingSince = null;
  const ultima = novas.at(-1)!;
  if (!conv) plano.status = 'in_progress';
  else if (conv.status === 'closed' && !naCarencia(conv.closedAt, ultima.timestamp)) plano.status = 'in_progress';
  return plano;
}
