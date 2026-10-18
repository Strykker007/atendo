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
 * Até onde um evento pode estar atrasado e ainda ser "atrasado": a Evolution repete webhook por
 * ~25 min (10 tentativas, backoff até 300 s). Diferença maior que isto não é atraso — é o relógio da
 * Evolution que voltou (NTP, host novo): aplica e recomeça a referência, senão o status ficaria
 * congelado por horas.
 */
export const MAX_EVENT_LAG_MS = 35 * 60_000;

export type OrderDecision = { apply: true; reason?: 'no_timestamp' } | { apply: false; reason: 'older_than_last' | 'older_than_health_check' };

/**
 * Aplica o evento? Puro (testado). `lastAt` = `date_time` do último evento aplicado do número;
 * `receivedAt`/`healthAt` = nosso relógio: quando o webhook chegou e quando o health check corrigiu
 * o status lendo o estado real. Evento que chegou antes da correção é mais velho que ela.
 * Empate aplica (não há como ordenar dentro do mesmo milissegundo).
 */
export function orderDecision(o: { at: number | null; lastAt: number | null; receivedAt?: number; healthAt?: number | null }): OrderDecision {
  if (o.receivedAt !== undefined && o.healthAt && o.receivedAt < o.healthAt) return { apply: false, reason: 'older_than_health_check' };
  if (o.at === null) return { apply: true, reason: 'no_timestamp' };
  if (o.lastAt !== null && o.at < o.lastAt && o.lastAt - o.at <= MAX_EVENT_LAG_MS) return { apply: false, reason: 'older_than_last' };
  return { apply: true };
}

/**
 * Mesma regra de `orderDecision` (parte do date_time), comparando e gravando num passo só (vários
 * workers). ARGV: at, ttl (s), MAX_EVENT_LAG_MS. Devolve {aplicou, anterior}.
 */
export const ORDER_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur and tonumber(ARGV[1]) < tonumber(cur) and tonumber(cur) - tonumber(ARGV[1]) <= tonumber(ARGV[3]) then return {0, cur} end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return {1, cur or ''}
`;

const DAY = 86_400;
export const connKeys = {
  lastAt: (numberId: string) => `wa:conn:at:${numberId}`,
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
    let decision: OrderDecision;
    try {
      const healthRaw = receivedAt !== undefined ? await this.redis.get(connKeys.health(number.id)) : null;
      decision = orderDecision({ at, lastAt: null, receivedAt, healthAt: healthRaw ? Number(healthRaw) : null });
      if (decision.apply && at !== null) {
        const [ok] = (await this.redis.eval(ORDER_LUA, 1, connKeys.lastAt(number.id), at, 30 * DAY, MAX_EVENT_LAG_MS)) as [number, string];
        if (!ok) decision = { apply: false, reason: 'older_than_last' };
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

  /** O health check corrigiu o status a partir do estado real: webhook que chegou antes disso fica velho. */
  async markHealthCorrection(numberId: string) {
    await this.redis.set(connKeys.health(numberId), String(Date.now()), 'EX', DAY).catch(() => undefined);
  }

  /** Últimos eventos do número (mais novo primeiro) — diagnóstico. */
  async recent(numberId: string, limit = 50) {
    const rows = await this.redis.lrange(connKeys.log(numberId), 0, Math.min(limit, CONN_LOG_MAX) - 1);
    return rows.map((r) => JSON.parse(r));
  }
}
