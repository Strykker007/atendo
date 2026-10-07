/**
 * Decisões do disparo em massa. Puro de propósito: é a lógica que decide **quando** e
 * **quanto** mandar, e errar aqui queima o número do cliente.
 *
 * A campanha não envia nada por conta própria — ela cria mensagens e as entrega à fila de
 * saída que já existe, herdando intervalo aleatório entre envios, teto diário por número e
 * aquecimento. Um caminho de envio paralelo seria a forma mais fácil de perder a proteção
 * contra banimento que já custou a ser construída.
 */

/** Quantas mensagens a campanha solta por vez. Pequeno de propósito: cada lote reconsulta o
 *  teto do dia e o horário, então uma pausa ou um bloqueio param o disparo em segundos. */
export const BATCH_SIZE = 25;

/** Entre lotes, quando ainda há fila. */
export const BATCH_INTERVAL_MS = 60_000;

/** Quando está fora do horário ou sem saldo no dia, não adianta insistir de minuto em minuto. */
export const IDLE_RETRY_MS = 15 * 60_000;

export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'done' | 'canceled';

export interface DispatchInput {
  now: number;
  status: CampaignStatus;
  /** quando começar; `null` = agora */
  startAt?: number | null;
  businessHoursOnly: boolean;
  isOpen: boolean;
  /** quanto ainda cabe no teto diário do número */
  dailyRemaining: number;
  /** alvos ainda não processados */
  pending: number;
}

export type Decision =
  | { action: 'send'; take: number }
  | { action: 'wait'; retryInMs: number; reason: string }
  | { action: 'done' }
  | { action: 'stop'; reason: string };

export function decideDispatch(i: DispatchInput): Decision {
  if (i.status === 'paused') return { action: 'stop', reason: 'Campanha pausada' };
  if (i.status === 'canceled') return { action: 'stop', reason: 'Campanha cancelada' };
  if (i.status === 'done') return { action: 'done' };

  // fila vazia antes de qualquer outra checagem: uma campanha que acabou não fica "esperando
  // o horário comercial" para sempre
  if (i.pending <= 0) return { action: 'done' };

  if (i.startAt && i.startAt > i.now) {
    return { action: 'wait', retryInMs: Math.min(i.startAt - i.now, IDLE_RETRY_MS), reason: 'Agendada para depois' };
  }

  if (i.businessHoursOnly && !i.isOpen) {
    return { action: 'wait', retryInMs: IDLE_RETRY_MS, reason: 'Fora do horário de funcionamento' };
  }

  if (i.dailyRemaining <= 0) {
    return { action: 'wait', retryInMs: IDLE_RETRY_MS, reason: 'Teto diário do número atingido' };
  }

  return { action: 'send', take: Math.min(i.pending, i.dailyRemaining, BATCH_SIZE) };
}

/** Sobrou fila depois do lote? Tipo estreito: quem chama só precisa tratar dois casos. */
export const afterBatch = (pendingAfter: number): { action: 'wait'; retryInMs: number; reason: string } | { action: 'done' } =>
  pendingAfter > 0 ? { action: 'wait', retryInMs: BATCH_INTERVAL_MS, reason: 'Próximo lote' } : { action: 'done' };

// ---------------------------------------------------------------------------

export const META_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface TargetInput {
  provider: 'meta' | 'evolution';
  hasTemplate: boolean;
  /** última mensagem recebida DESTE contato; `null` = nunca escreveu */
  lastInboundAt?: number | null;
  optedOut: boolean;
  now: number;
}

export type Eligibility = { ok: true } | { ok: false; reason: string };

/**
 * O contato pode receber? Checado **antes** de criar a mensagem: um alvo inelegível vira
 * "ignorado" com motivo, em vez de virar mensagem que falha no provider — falha consome
 * tentativa, polui o histórico do contato e, na Meta, conta como violação.
 */
export function eligible(t: TargetInput): Eligibility {
  // descadastro vale para qualquer provider e é a regra que mais protege o número:
  // insistir com quem pediu para sair é o caminho mais curto para a denúncia
  if (t.optedOut) return { ok: false, reason: 'Contato pediu para não receber mensagens' };

  // regra da Meta: fora da janela de 24h só sai template aprovado
  if (t.provider === 'meta' && !t.hasTemplate) {
    const inWindow = !!t.lastInboundAt && t.now - t.lastInboundAt < META_WINDOW_MS;
    if (!inWindow) return { ok: false, reason: 'Fora da janela de 24h — use um template aprovado' };
  }

  return { ok: true };
}

/** Palavras que, recebidas do contato, marcam descadastro. */
export const OPT_OUT_WORDS = ['sair', 'parar', 'cancelar', 'descadastrar', 'remover', 'stop'];
/**
 * Palavras que também são RESPOSTA comum: "cancelar" é como se cancela um horário no robô de
 * agendamento. Só viram descadastro quando não há nada esperando resposta (o inbound confere).
 */
export const AMBIGUOUS_OPT_OUT_WORDS = ['cancelar'];

/**
 * A mensagem recebida é um pedido de descadastro? Deliberadamente **estrita** — roda em toda
 * mensagem que entra, e marcar por engano faria o cliente parar de receber sem ter pedido.
 */
export function isOptOut(text?: string | null): boolean {
  const clean = normalizeOptOut(text);
  return !!clean && OPT_OUT_WORDS.includes(clean);
}

/** "cancelar" e afins: descadastro só se não for resposta a fluxo/agendamento. */
export function isAmbiguousOptOut(text?: string | null): boolean {
  const clean = normalizeOptOut(text);
  return !!clean && AMBIGUOUS_OPT_OUT_WORDS.includes(clean);
}

function normalizeOptOut(text?: string | null): string | null {
  if (!text) return null;
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.!?]+$/, '');
}
