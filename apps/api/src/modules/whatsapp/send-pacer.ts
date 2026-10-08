import { Injectable } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service';
import { AUTO_GAP_MS, type SendLimits } from '@atendo/shared';
import { dailyLimit, delayMs, withinDailyLimit, type SendDelayProfile } from './sending-policy';

const nextKey = (numberId: string) => `wa:next:${numberId}`;
const rateKey = (numberId: string) => `wa:rate:${numberId}`;
const convNextKey = (conversationId: string) => `wa:cnext:${conversationId}`;
const convBurstKey = (conversationId: string) => `wa:cburst:${conversationId}`;
const convDoneKey = (conversationId: string) => `wa:cdone:${conversationId}`;
const lastKey = (numberId: string) => `wa:last:${numberId}`;
const autoKey = (numberId: string) => `wa:auto:${numberId}`;
const warmKey = (numberId: string) => `wa:wconv:${numberId}`;
const readKey = (conversationId: string) => `wa:read:${conversationId}`;
const dayKey = (numberId: string, day: string) => `wa:sent:${numberId}:${day}`;
const today = (d = new Date()) => d.toISOString().slice(0, 10);

/**
 * Reserva o horário de um envio respeitando, ao mesmo tempo:
 * - o perfil do número (`wa:next`, intervalo aleatório entre envios do número). Número ocioso
 *   (sem envio recente) também espera um sorteio antes da 1ª mensagem (`idleDelay`) — inclusive
 *   a digitada pelo atendente: mensagem que sai no mesmo instante do gatilho é padrão de robô;
 * - o limite por minuto do número (`wa:rate`, janela deslizante de reservas);
 * - o intervalo mínimo da conversa (`wa:cnext`);
 * - a rajada da conversa (`wa:cburst`, N mensagens por janela);
 * - o piso do Conteúdo (`minGap` desde a última entrega na conversa, `wa:cdone`);
 * - envio AUTOMÁTICO (sem autor humano): espaçamento sorteado desde o último envio do número
 *   (`wa:last`, qualquer origem) e teto por hora de automáticas (`wa:auto`). O atendente não
 *   espera por isto — só o automático abre distância.
 *
 * Script Lua = atômico: com vários workers, dois jobs leriam o mesmo "próximo horário livre" e
 * sairiam juntos — exatamente a rajada que se quer evitar. Toda reserva fica ≤ o "próximo"
 * gravado, então empurrar `t` para a frente nunca faz entrar reserva nova na janela; o laço
 * só repete porque cumprir uma janela pode violar a outra.
 *
 * Devolve { espera em ms, 1 se a rajada da conversa foi o que segurou, 1 se o teto por hora de automáticas segurou }.
 */
const RESERVE = `
local now = tonumber(ARGV[1])
local numDelay = tonumber(ARGV[2])
local rateLimit = tonumber(ARGV[3])
local convInterval = tonumber(ARGV[4])
local burstMax = tonumber(ARGV[5])
local burstWin = tonumber(ARGV[6])
local member = ARGV[7]
local minGap = tonumber(ARGV[8])
local idleDelay = tonumber(ARGV[9])
local autoGap = tonumber(ARGV[10])
local autoLimit = tonumber(ARGV[11])
local t = now
local nxt = tonumber(redis.call('GET', KEYS[1]) or '0')
-- em sequência o intervalo já conta da entrega anterior; ocioso, espera um sorteio (não somam)
if nxt > now then t = nxt else t = now + idleDelay end
if autoGap > 0 then
  local last = tonumber(redis.call('GET', KEYS[6]) or '0')
  if last > 0 and last + autoGap > t then t = last + autoGap end
end
local cnxt = tonumber(redis.call('GET', KEYS[3]) or '0')
if cnxt > t then t = cnxt end
if minGap > 0 then
  local done = tonumber(redis.call('GET', KEYS[5]) or '0')
  if done > 0 and done + minGap > t then t = done + minGap end
end
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
local capped = 0
for _ = 1, 10 do
  local a = fit(KEYS[2], rateLimit, 60000)
  local b = fit(KEYS[4], burstMax, burstWin)
  local c = fit(KEYS[7], autoLimit, 3600000)
  if b then burst = 1 end
  if c then capped = 1 end
  if not a and not b and not c then break end
end
local ttl = (t - now) + 3600000
redis.call('SET', KEYS[1], t + numDelay, 'PX', ttl)
redis.call('SET', KEYS[3], t + convInterval, 'PX', ttl)
redis.call('ZADD', KEYS[2], t, member)
redis.call('PEXPIRE', KEYS[2], ttl)
redis.call('ZADD', KEYS[4], t, member)
redis.call('PEXPIRE', KEYS[4], ttl)
local lastCur = tonumber(redis.call('GET', KEYS[6]) or '0')
if t > lastCur then redis.call('SET', KEYS[6], t, 'PX', ttl) end
if autoLimit > 0 then
  redis.call('ZADD', KEYS[7], t, member)
  redis.call('PEXPIRE', KEYS[7], ttl + 3600000)
end
return { t - now, burst, capped }
`;

/**
 * Aquecimento (number-warmup.ts): contato que já recebeu nesta hora passa direto; contato novo
 * entra se couber no teto de contatos/hora. Devolve quanto esperar (0 = pode seguir).
 */
const CLAIM_CONV = `
local now = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local member = ARGV[3]
local win = 3600000
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - win)
if redis.call('ZSCORE', KEYS[1], member) then return 0 end
if redis.call('ZCARD', KEYS[1]) < cap then
  redis.call('ZADD', KEYS[1], now, member)
  redis.call('PEXPIRE', KEYS[1], win)
  return 0
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
return tonumber(oldest[2]) + win - now
`;

/**
 * Depois da entrega: o próximo envio do número só sai `numDelay` depois DESTE instante (não do
 * horário reservado). Sem isto, uma mídia que levou 6 s para subir "gastava" o intervalo de
 * 3–5 s e a mensagem seguinte do fluxo saía colada. Só empurra para a frente (max).
 */
const DELIVERED = `
local now = tonumber(ARGV[1])
local ttl = 3600000
local function bump(key, v)
  local cur = tonumber(redis.call('GET', key) or '0')
  if v > cur then redis.call('SET', key, v, 'PX', ttl) end
end
bump(KEYS[1], now + tonumber(ARGV[2]))
bump(KEYS[2], now + tonumber(ARGV[3]))
redis.call('SET', KEYS[3], now, 'PX', ttl)
bump(KEYS[4], now)
return 1
`;

export interface ReserveInput {
  numberId: string;
  conversationId: string;
  /** id da mensagem — membro da janela (único) */
  messageId: string;
  profile: SendDelayProfile;
  limits: SendLimits;
  /** piso desde a última entrega na conversa (`OutboundJob.minGapMs`) */
  minGapMs?: number;
  /** envio sem autor humano (fluxo, boas-vindas, lembrete, campanha) */
  automated?: boolean;
  provider?: string;
  /** piso entre envios do número na 1ª fase do aquecimento (vale também para o atendente) */
  warmupGapMs?: number;
}

/** espaçamento do automático: só no QR (a Meta não pune ritmo) */
const autoGapMs = (i: ReserveInput) => (i.automated && i.provider !== 'meta' ? AUTO_GAP_MS[0] + Math.floor(Math.random() * (AUTO_GAP_MS[1] - AUTO_GAP_MS[0] + 1)) : 0);

@Injectable()
export class SendPacer {
  constructor(private readonly redis: RedisService) {}

  /** Quanto este envio deve esperar (ms) e se foi a rajada da conversa. Já reserva a vaga. */
  async reserve(i: ReserveInput): Promise<{ waitMs: number; burst: boolean; autoCapped: boolean }> {
    const gap = Math.max(autoGapMs(i), i.warmupGapMs ?? 0);
    const res = (await this.redis.eval(
      RESERVE,
      7,
      nextKey(i.numberId),
      rateKey(i.numberId),
      convNextKey(i.conversationId),
      convBurstKey(i.conversationId),
      convDoneKey(i.conversationId),
      lastKey(i.numberId),
      autoKey(i.numberId),
      String(Date.now()),
      String(delayMs(i.profile)),
      String(i.limits.ratePerMinute),
      String(Math.round(i.limits.convMinIntervalSec * 1000)),
      String(i.limits.convBurstMax),
      String(i.limits.convBurstWindowSec * 1000),
      i.messageId,
      String(Math.max(0, Math.round(i.minGapMs ?? 0))),
      // sorteio próprio para a 1ª mensagem (o de ARGV[2] é o intervalo até a próxima); automático
      // com o número ocioso também espera o sorteio dele
      String(Math.max(delayMs(i.profile), gap)),
      String(gap),
      String(i.automated ? i.limits.autoPerHour : 0),
    )) as [number, number, number] | null;
    return { waitMs: Math.max(0, Number(res?.[0] ?? 0)), burst: Number(res?.[1] ?? 0) === 1, autoCapped: Number(res?.[2] ?? 0) === 1 };
  }

  /** Mensagem entregue ao provider: o intervalo do número (sorteado de novo) e o da conversa contam daqui. */
  async delivered(i: { numberId: string; conversationId: string; profile: SendDelayProfile; limits: SendLimits }) {
    await this.redis.eval(
      DELIVERED,
      4,
      nextKey(i.numberId),
      convNextKey(i.conversationId),
      convDoneKey(i.conversationId),
      lastKey(i.numberId),
      String(Date.now()),
      String(delayMs(i.profile)),
      String(Math.round(i.limits.convMinIntervalSec * 1000)),
    );
  }

  /** Aquecimento: ms até caber este contato no teto de contatos novos/hora (0 = pode seguir). */
  async claimWarmupConversation(numberId: string, contactId: string, perHour: number) {
    const wait = await this.redis.eval(CLAIM_CONV, 1, warmKey(numberId), String(Date.now()), String(perHour), contactId);
    return Math.max(0, Number(wait ?? 0));
  }

  /** Já marcou esta mensagem recebida como lida? Grava a nova e devolve se precisa chamar o provider. */
  async shouldMarkRead(conversationId: string, externalId: string) {
    const prev = await this.redis.get(readKey(conversationId));
    if (prev === externalId) return false;
    await this.redis.set(readKey(conversationId), externalId, 'EX', 86_400);
    return true;
  }

  /** Devolve a vaga quando o envio não vai acontecer (bloqueio de quota, mensagem sumiu). */
  async release(numberId: string) {
    await this.redis.del(nextKey(numberId));
  }

  async sentToday(numberId: string, day = today()) {
    return Number((await this.redis.get(dayKey(numberId, day))) ?? 0);
  }

  /** Conta o envio proativo no dia (resposta não conta). A chave expira sozinha em 48h. */
  async countSend(numberId: string, day = today()) {
    const key = dayKey(numberId, day);
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 172_800);
    return n;
  }

  /** Teto efetivo de hoje (considerando aquecimento) e quanto já foi enviado. */
  async dailyStatus(number: { id: string; provider: string; sendDailyLimit: number; warmupStartedAt: Date | null }) {
    const limit = dailyLimit({ configured: number.sendDailyLimit, warmupStartedAt: number.warmupStartedAt, provider: number.provider });
    const sent = await this.sentToday(number.id);
    return { limit, sent, ...withinDailyLimit(sent, limit) };
  }
}
