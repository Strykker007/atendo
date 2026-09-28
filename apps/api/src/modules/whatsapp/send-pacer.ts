import { Injectable } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service';
import { dailyLimit, delayMs, withinDailyLimit, type SendDelayProfile } from './sending-policy';

const nextKey = (numberId: string) => `wa:next:${numberId}`;
const dayKey = (numberId: string, day: string) => `wa:sent:${numberId}:${day}`;
const today = (d = new Date()) => d.toISOString().slice(0, 10);

/**
 * Reserva o próximo horário de envio de um número.
 *
 * A reserva é feita num script Lua (atômica) porque há vários workers: sem isso, dois
 * jobs leriam o mesmo "próximo horário livre" e disparariam juntos — exatamente a rajada
 * que se quer evitar.
 */
const RESERVE = `
local nxt = tonumber(redis.call('GET', KEYS[1]) or '0')
local now = tonumber(ARGV[1])
local delay = tonumber(ARGV[2])
local start = nxt
if start < now then start = now end
redis.call('SET', KEYS[1], start + delay, 'PX', 900000)
return start - now
`;

@Injectable()
export class SendPacer {
  constructor(private readonly redis: RedisService) {}

  /** Quanto este envio deve esperar (ms). Já reserva a vaga para os demais jobs. */
  async reserve(numberId: string, profile: SendDelayProfile): Promise<number> {
    const wait = delayMs(profile);
    if (!wait) return 0;
    const now = Date.now();
    const res = await this.redis.eval(RESERVE, 1, nextKey(numberId), String(now), String(wait));
    return Math.max(0, Number(res ?? 0));
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
