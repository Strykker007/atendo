import { Injectable } from '@nestjs/common';
import type { WhatsAppNumber } from '@prisma/client';
import { RedisService } from '../../common/redis/redis.service';
import { AppLogger } from '../../common/observability/app-logger';
import type { ParsedWebhook } from './providers/provider.interface';

/**
 * Eventos `connection.update` (docs/28-estabilizacao-conexao.md): registro de todos e proteção
 * contra evento atrasado sobrescrevendo um estado mais novo.
 *
 * A fila `wa-inbound` roda em paralelo (10 por worker, 2 workers) e a Evolution repete webhook
 * que falhou por até ~30 min: um `open` antigo podia chegar depois de um `close` e o painel
 * ficava "conectado" com o número fora (ou o contrário).
 */

/**
 * Fechamentos em que a Evolution 2.3.7 NÃO reconecta e apaga as credenciais (precisa de QR).
 * 401 era o único tratado; 402/403/406 caíam como desconexão comum, sem pausa — e re-parear
 * logo depois de uma restrição é o que mais queima o número (docs/24 › 3.1).
 */
export const DEFINITIVE_CLOSE: Record<number, string> = {
  401: 'sessão encerrada pelo WhatsApp: aparelho removido no celular ou logout',
  402: 'conexão recusada pelo WhatsApp (402)',
  403: 'acesso negado pelo WhatsApp — conta banida ou restrita',
  406: 'conexão recusada pelo WhatsApp (406) — conta bloqueada ou restrita',
};

export const isDefinitiveClose = (state: string | undefined, code: number | undefined) =>
  state === 'close' && code !== undefined && code in DEFINITIVE_CLOSE;

/**
 * Instante do evento no relógio da Evolution (`date_time` do webhook). A 2.3.7 manda a hora LOCAL
 * do container com sufixo "Z" — não é UTC, então só se compara com outro `date_time` dela (mesmo
 * relógio), nunca com `Date.now()`.
 */
export function eventTime(at: string | undefined): number | null {
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : null;
}

/**
 * Carimbo que a guarda de conexão da Evolution põe no estado (docs/29-reconexao-evolution.md):
 * `boot` cresce a cada início do processo (arquivo no volume + piso no relógio), `seq` cresce a cada
 * mudança de estado dentro do processo, `gen` é a geração do socket. Ordem total e confiável,
 * sem depender de relógio.
 */
export interface ConnOrder { boot: number; seq: number; gen?: number }

/**
 * Evento de um processo ANTERIOR (boot menor) só pode chegar enquanto aquele processo vivia — as
 * retentativas de webhook da Evolution morrem com ele. Passado este tempo desde que o boot atual
 * apareceu, boot menor não é atraso: é o contador que recomeçou (volume perdido com o relógio
 * atrasado) — aplica e recomeça a referência. Antes disso, é atrasado e não sobrescreve.
 */
export const BOOT_SWITCH_WINDOW_MS = 40 * 60_000;

export type OrderDecision =
  | { apply: true; reason?: 'no_timestamp' | 'boot_reset' }
  | { apply: false; reason: 'older_than_last' | 'duplicate' | 'older_than_health_check' };

/**
 * Aplica o evento? Puro (testado; os scripts Lua abaixo fazem o mesmo no Redis, num passo só).
 *  1. Chegou (nosso relógio) antes de o health check corrigir o status lendo o estado real → velho.
 *  2. Com carimbo: (boot, seq) estritamente maior que o último aplicado; igual = duplicata (retentativa).
 *  3. Sem carimbo (imagem sem a guarda, ou evento sem estado): `date_time` não menor que o último.
 *     Sem atalho por diferença de horário — relógio que volta é corrigido pela reconciliação do
 *     health check, que zera esta referência (`markHealthCorrection`).
 */
export function orderDecision(o: {
  order?: ConnOrder | null; lastOrder?: (ConnOrder & { seenAt?: number }) | null;
  at: number | null; lastAt: number | null; receivedAt?: number; healthAt?: number | null;
}): OrderDecision {
  if (o.receivedAt !== undefined && o.healthAt && o.receivedAt < o.healthAt) return { apply: false, reason: 'older_than_health_check' };
  if (o.order) {
    const last = o.lastOrder;
    if (!last) return { apply: true };
    if (o.order.boot === last.boot) {
      if (o.order.seq === last.seq) return { apply: false, reason: 'duplicate' };
      return o.order.seq > last.seq ? { apply: true } : { apply: false, reason: 'older_than_last' };
    }
    if (o.order.boot > last.boot) return { apply: true };
    const fora = o.receivedAt !== undefined && last.seenAt !== undefined && o.receivedAt - last.seenAt > BOOT_SWITCH_WINDOW_MS;
    return fora ? { apply: true, reason: 'boot_reset' } : { apply: false, reason: 'older_than_last' };
  }
  if (o.at === null) return { apply: true, reason: 'no_timestamp' };
  if (o.lastAt !== null && o.at < o.lastAt) return { apply: false, reason: 'older_than_last' };
  return { apply: true };
}

/**
 * Ordem por carimbo. Valor guardado: "boot:seq:seenAt" (seenAt = quando, no nosso relógio, este
 * boot apareceu). ARGV: boot, seq, receivedAt, ttl (s), BOOT_SWITCH_WINDOW_MS.
 * Devolve {1, anterior} se aplicou, {0, anterior} se não.
 */
export const ORDER_SEQ_LUA = `
local cur = redis.call('GET', KEYS[1])
local nb, ns, now = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local seen = now
if cur then
  local b, s, t = string.match(cur, '^(%d+):(%d+):(%d+)$')
  b, s, t = tonumber(b), tonumber(s), tonumber(t)
  if b then
    if nb == b then
      if ns <= s then return {0, cur} end
      seen = t
    elseif nb < b and now - t <= tonumber(ARGV[5]) then
      return {0, cur}
    end
  end
end
redis.call('SET', KEYS[1], ARGV[1] .. ':' .. ARGV[2] .. ':' .. seen, 'EX', ARGV[4])
return {1, cur or ''}
`;

/** Ordem pelo date_time (sem carimbo): não aplica evento mais velho. ARGV: at, ttl (s). */
export const ORDER_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur and tonumber(ARGV[1]) < tonumber(cur) then return {0, cur} end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return {1, cur or ''}
`;

/** "boot:seq:seenAt" → objeto (para o motivo do descarte no log) */
export function parseStoredOrder(raw: string | null | undefined): (ConnOrder & { seenAt: number }) | null {
  const m = /^(\d+):(\d+):(\d+)$/.exec(raw ?? '');
  return m ? { boot: Number(m[1]), seq: Number(m[2]), seenAt: Number(m[3]) } : null;
}

const DAY = 86_400;
export const connKeys = {
  lastAt: (numberId: string) => `wa:conn:at:${numberId}`,
  lastOrder: (numberId: string) => `wa:conn:ord:${numberId}`,
  health: (numberId: string) => `wa:conn:hc:${numberId}`,
  log: (numberId: string) => `wa:conn:log:${numberId}`,
};
/** quantos eventos guardar por número (lista no Redis, 30 dias) */
export const CONN_LOG_MAX = 200;

type Conn = NonNullable<ParsedWebhook['connection']>;

@Injectable()
export class ConnectionEventsService {
  private readonly log = new AppLogger('ConnectionEvents');

  constructor(private readonly redis: RedisService) {}

  /**
   * Registra o evento (log estruturado + últimos 200 no Redis) e diz se deve ser aplicado.
   * Redis fora do ar: aplica, como antes desta proteção — melhor que travar o status.
   */
  async record(number: Pick<WhatsAppNumber, 'id' | 'label' | 'status'>, c: Conn, receivedAt?: number): Promise<OrderDecision> {
    const at = eventTime(c.at);
    const now = receivedAt ?? Date.now();
    let decision: OrderDecision;
    try {
      const healthRaw = receivedAt !== undefined ? await this.redis.get(connKeys.health(number.id)) : null;
      decision = orderDecision({ order: null, at: null, lastAt: null, receivedAt, healthAt: healthRaw ? Number(healthRaw) : null });
      if (decision.apply && c.order) {
        const [ok, prev] = (await this.redis.eval(ORDER_SEQ_LUA, 1, connKeys.lastOrder(number.id), c.order.boot, c.order.seq, now, 30 * DAY, BOOT_SWITCH_WINDOW_MS)) as [number, string];
        // o motivo (duplicata × atrasado × boot recomeçado) sai da mesma regra pura
        decision = orderDecision({ order: c.order, lastOrder: parseStoredOrder(prev), at, lastAt: null, receivedAt: now });
        if (!ok && decision.apply) decision = { apply: false, reason: 'older_than_last' };
        if (ok && !decision.apply) decision = { apply: true };
      } else if (decision.apply && at !== null) {
        const [ok] = (await this.redis.eval(ORDER_LUA, 1, connKeys.lastAt(number.id), at, 30 * DAY)) as [number, string];
        if (!ok) decision = { apply: false, reason: 'older_than_last' };
      } else if (decision.apply) {
        decision = { apply: true, reason: 'no_timestamp' };
      }
    } catch (err) {
      this.log.warn(`ordem do connection.update sem Redis (${err instanceof Error ? err.message : err}) — aplicando`);
      decision = { apply: true };
    }

    const entry = {
      numberId: number.id,
      label: number.label,
      statusBefore: number.status,
      state: c.state,
      status: c.status,
      statusReason: c.statusReason,
      definitive: isDefinitiveClose(c.state, c.statusReason),
      at: c.at,
      order: c.order,
      receivedAt: receivedAt ? new Date(receivedAt).toISOString() : undefined,
      applied: decision.apply,
      skipReason: decision.apply ? undefined : decision.reason,
    };
    if (entry.definitive) this.log.warn(`wa.connection ${number.label}: close ${c.statusReason} (${DEFINITIVE_CLOSE[c.statusReason!]})`, entry);
    else this.log.log(`wa.connection ${number.label}: ${c.state ?? c.status}${c.statusReason ? ` ${c.statusReason}` : ''}${decision.apply ? '' : ` — ignorado (${decision.reason})`}`, entry);
    await this.redis
      .multi()
      .lpush(connKeys.log(number.id), JSON.stringify(entry))
      .ltrim(connKeys.log(number.id), 0, CONN_LOG_MAX - 1)
      .expire(connKeys.log(number.id), 30 * DAY)
      .exec()
      .catch(() => undefined);
    return decision;
  }

  /**
   * Reconciliação: o health check corrigiu o status lendo o estado real. Webhook que chegou antes
   * disto fica velho; e a referência do date_time (fallback sem carimbo) recomeça — se o relógio da
   * Evolution voltou, os eventos seguintes não ficam presos atrás de um horário do futuro.
   */
  async markHealthCorrection(numberId: string) {
    await this.redis.multi().set(connKeys.health(numberId), String(Date.now()), 'EX', DAY).del(connKeys.lastAt(numberId)).exec().catch(() => undefined);
  }

  /** Últimos eventos do número (mais novo primeiro) — diagnóstico. */
  async recent(numberId: string, limit = 50) {
    const rows = await this.redis.lrange(connKeys.log(numberId), 0, Math.min(limit, CONN_LOG_MAX) - 1);
    return rows.map((r) => JSON.parse(r));
  }
}
