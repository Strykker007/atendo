import { Injectable } from '@nestjs/common';
import type { WhatsAppNumber } from '@prisma/client';
import { RedisService } from '../../common/redis/redis.service';
import { AppLogger } from '../../common/observability/app-logger';

/**
 * Sessão "conectada" mas inoperante (docs/28-estabilizacao-conexao.md › Sonda).
 *
 * A Evolution diz `open` pela variável em memória; o socket pode estar morto por baixo (zumbi) e
 * nada avisa. Para número conectado e quieto, o health check faz uma consulta leve ao WhatsApp
 * pela sessão (foto de perfil do próprio número) e mede se ela RESPONDE no prazo.
 *
 * Só registra e avisa — nunca reinicia: silêncio pode ser loja parada, e reiniciar sem a
 * exclusividade de conexão (etapa 3 do doc 28) arrisca abrir socket duplicado.
 *
 * Limite conhecido: a Evolution 2.3.7 engole o erro dessa rota e responde `null` na hora quando o
 * socket já está fechado ("Connection Closed") — esse caso continua com o restart do envio
 * (OutboundProcessor). A sonda pega o zumbi que TRAVA: não responde no prazo.
 */

/** só sonda número sem sinal de vida (mensagem recebida, entrega/leitura) há este tempo */
export const PROBE_AFTER_SILENCE_MS = 30 * 60_000;
/** falhas seguidas para marcar como inoperante (health check a cada 5 min → ~10 min) */
export const PROBE_FAILS_TO_FLAG = 2;

/** `silentMs` null = sem sinal recente conhecido (sessão nova ou parada há dias): sonda também */
export const shouldProbe = (silentMs: number | null) => silentMs === null || silentMs >= PROBE_AFTER_SILENCE_MS;

export interface ProbeState {
  fails: number;
  /** primeira falha da sequência atual (ISO) */
  since?: string;
  lastError?: string;
  lastOkAt?: string;
  /** marcado como inoperante (ISO) */
  flaggedAt?: string;
}

/** Próximo estado depois de uma sonda. Puro (testado). `event` diz o que logar. */
export function nextProbeState(prev: ProbeState | null, ok: boolean, now: Date, error?: string): { state: ProbeState; event: 'flagged' | 'recovered' | null } {
  const p = prev ?? { fails: 0 };
  if (ok) return { state: { fails: 0, lastOkAt: now.toISOString() }, event: p.flaggedAt ? 'recovered' : null };
  const fails = p.fails + 1;
  const state: ProbeState = { ...p, fails, since: p.since ?? now.toISOString(), lastError: error };
  if (fails >= PROBE_FAILS_TO_FLAG && !p.flaggedAt) return { state: { ...state, flaggedAt: now.toISOString() }, event: 'flagged' };
  return { state, event: null };
}

export const probeKey = (numberId: string) => `wa:probe:${numberId}`;

@Injectable()
export class SessionProbe {
  private readonly log = new AppLogger('SessionProbe');

  constructor(private readonly redis: RedisService) {}

  async check(n: Pick<WhatsAppNumber, 'id' | 'label'>, probe: () => Promise<void>) {
    let ok = true;
    let error: string | undefined;
    try {
      await probe();
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : String(err);
    }
    const prev = await this.get(n.id);
    const { state, event } = nextProbeState(prev, ok, new Date(), error);
    await this.redis.set(probeKey(n.id), JSON.stringify(state), 'EX', 86_400).catch(() => undefined);
    const fields = { numberId: n.id, label: n.label, ...state };
    if (event === 'flagged') this.log.warn(`wa.zombie ${n.label}: Evolution diz conectado, mas a sessão não responde há ${state.fails} verificações — reiniciar a conexão no painel; se não voltar, ler o QR`, fields);
    else if (event === 'recovered') this.log.log(`wa.zombie ${n.label}: sessão voltou a responder`, fields);
    else if (!ok) this.log.debug(`wa.probe ${n.label}: sem resposta (${state.fails}/${PROBE_FAILS_TO_FLAG})`, fields);
    return state;
  }

  async get(numberId: string): Promise<ProbeState | null> {
    const raw = await this.redis.get(probeKey(numberId)).catch(() => null);
    return raw ? (JSON.parse(raw) as ProbeState) : null;
  }

  /** número saiu de "conectado": a sequência não vale mais */
  async clear(numberId: string) {
    await this.redis.del(probeKey(numberId)).catch(() => undefined);
  }
}
