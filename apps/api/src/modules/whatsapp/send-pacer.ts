import { Injectable } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service';
import type { SendLimits } from '@atendo/shared';
import { dailyLimit, delayMs, withinDailyLimit, type SendDelayProfile } from './sending-policy';

const nextKey = (numberId: string) => `wa:next:${numberId}`;
const rateKey = (numberId: string) => `wa:rate:${numberId}`;
const convNextKey = (conversationId: string) => `wa:cnext:${conversationId}`;
const convBurstKey = (conversationId: string) => `wa:cburst:${conversationId}`;
const dayKey = (numberId: string, day: string) => `wa:sent:${numberId}:${day}`;
const today = (d = new Date()) => d.toISOString().slice(0, 10);

/**
 * Reserva o horário de um envio respeitando, ao mesmo tempo:
 * - o perfil do número (`wa:next`, intervalo aleatório entre envios do número);
 * - o limite por minuto do número (`wa:rate`, janela deslizante de reservas);
 * - o intervalo mínimo da conversa (`wa:cnext`);
 * - a rajada da conversa (`wa:cburst`, N mensagens por janela).
 *
 * Script Lua = atômico: com vários workers, dois jobs leriam o mesmo "próximo horário livre" e
 * sairiam juntos — exatamente a rajada que se quer evitar. Toda reserva fica ≤ o "próximo"
 * gravado, então empurrar `t` para a frente nunca faz entrar reserva nova na janela; o laço
 * só repete porque cumprir uma janela pode violar a outra.
 *
 * Devolve { espera em ms, 1 se a rajada da conversa foi o que segurou }.
 */
const RESERVE = `
local now = tonumber(ARGV[1])
local numDelay = tonumber(ARGV[2])
local rateLimit = tonumber(ARGV[3])
local convInterval = tonumber(ARGV[4])
local burstMax = tonumber(ARGV[5])
local burstWin = tonumber(ARGV[6])
local member = ARGV[7]
local t = now
local nxt = tonumber(redis.call('GET', KEYS[1]) or '0')
if nxt > t then t = nxt end
local cnxt = tonumber(redis.call('GET', KEYS[3]) or '0')
if cnxt > t then t = cnxt end
local function fit(key, limit, win)
  if limit <= 0 then return false end
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - win)
  local s = redis.call('ZRANGEBYSCORE', key, '(' .. (t - win), '+inf', 'WITHSCORES')
  local n = #s / 2
  if n >= limit then
    local v = tonumber(s[(n - limit) * 2 + 2]) + win
    if v > t then t = v; return true end
  end
  return false
end
local burst = 0
for _ = 1, 10 do
  local a = fit(KEYS[2], rateLimit, 60000)
  local b = fit(KEYS[4], burstMax, burstWin)
  if b then burst = 1 end
  if not a and not b then break end
end
local ttl = (t - now) + 3600000
redis.call('SET', KEYS[1], t + numDelay, 'PX', ttl)
redis.call('SET', KEYS[3], t + convInterval, 'PX', ttl)
redis.call('ZADD', KEYS[2], t, member)
redis.call('PEXPIRE', KEYS[2], ttl)
redis.call('ZADD', KEYS[4], t, member)
redis.call('PEXPIRE', KEYS[4], ttl)
return { t - now, burst }
`;

export interface ReserveInput {
  numberId: string;
  conversationId: string;
  /** id da mensagem — membro da janela (único) */
  messageId: string;
  profile: SendDelayProfile;
  limits: SendLimits;
}

@Injectable()
export class SendPacer {
  constructor(private readonly redis: RedisService) {}

  /** Quanto este envio deve esperar (ms) e se foi a rajada da conversa. Já reserva a vaga. */
  async reserve(i: ReserveInput): Promise<{ waitMs: number; burst: boolean }> {
    const res = (await this.redis.eval(
      RESERVE,
      4,
      nextKey(i.numberId),
      rateKey(i.numberId),
      convNextKey(i.conversationId),
      convBurstKey(i.conversationId),
      String(Date.now()),
      String(delayMs(i.profile)),
      String(i.limits.ratePerMinute),
      String(Math.round(i.limits.convMinIntervalSec * 1000)),
      String(i.limits.convBurstMax),
      String(i.limits.convBurstWindowSec * 1000),
      i.messageId,
    )) as [number, number] | null;
    return { waitMs: Math.max(0, Number(res?.[0] ?? 0)), burst: Number(res?.[1] ?? 0) === 1 };
  }

  /** Devolve a vaga quando o envio não vai acontecer (bloqueio de quota, mensagem sumiu). */
  async release(numberId: string) {
    await this.redis.del(nextKey(numberId));
  }

  async sentToday(numberId: string, day = today()) {
    return Number((await this.redis.get(dayKey(numberId, day))) ?? 0);
  }

  /** Conta o envio no dia. A chave expira sozinha em 48h. */
  async countSend(numberId: string, day = today()) {
    const key = dayKey(numberId, day);
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 172_800);
    return n;
  }

  /** Teto efetivo de hoje (considerando aquecimento) e quanto já foi enviado. */
  async dailyStatus(number: { id: string; sendDailyLimit: number; warmupStartedAt: Date | null }) {
    const limit = dailyLimit({ configured: number.sendDailyLimit, warmupStartedAt: number.warmupStartedAt });
    const sent = await this.sentToday(number.id);
    return { limit, sent, ...withinDailyLimit(sent, limit) };
  }
}
