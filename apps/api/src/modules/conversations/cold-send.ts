import type Redis from 'ioredis';
import { COLD_CONTACTS_PER_DAY } from '@atendo/shared';

/**
 * Envio frio (docs/envio.md#envio-frio): mensagem para quem não escreveu nas últimas 24h.
 *
 * É a causa nº 1 de banimento no número não oficial (Evolution). A regra: no não oficial o
 * atendente pode falar primeiro com até `COLD_CONTACTS_PER_DAY` contatos frios por dia no número
 * (janela deslizante de 24 h; voltar a escrever para o mesmo contato não gasta outra vaga) — o
 * suficiente para retomar um cliente sem virar disparo. Envio automático (fluxo, boas-vindas)
 * para contato frio continua recusado. Volume é pelo número oficial, com template aprovado e o
 * recurso `proactive_messaging` no plano. Exceção: lembretes e avisos da Agenda — o cliente
 * pediu o contato ao agendar, o texto é esperado e o volume é baixo.
 */
export const COLD_WINDOW_MS = 24 * 60 * 60 * 1000;

export const isWarm = (lastInboundAt: Date | null | undefined, now = Date.now()) => !!lastInboundAt && now - lastInboundAt.getTime() < COLD_WINDOW_MS;

/** Automático (fluxo, boas-vindas…) para contato frio no não oficial, sem atendente que tenha falado primeiro. */
export const COLD_UNOFFICIAL_MESSAGE =
  'Este contato não escreve neste número há mais de 24 horas. Para proteger o número de bloqueio, ' +
  'mensagem automática só sai para quem escreveu nas últimas 24 horas. Assim que o contato responder, ' +
  'a automação volta a funcionar.';

const quando = (d: Date) => {
  const sp = (x: Date) => x.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  return sp(d) === sp(new Date()) ? `hoje às ${hora}` : `${d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })} às ${hora}`;
};

/** Atendente sem vaga de contato frio no número. */
export const coldQuotaMessage = (resetsAt: Date | null) =>
  `Este contato não escreve neste número há mais de 24 horas, e o número já falou primeiro com ${COLD_CONTACTS_PER_DAY} ` +
  'contatos assim nas últimas 24 horas — é o limite diário para proteger o número de bloqueio. ' +
  (resetsAt ? `Uma nova vaga libera ${quando(resetsAt)}. ` : '') +
  'Se o contato responder, a conversa volta a funcionar normalmente. Para falar com muitos contatos, use o número oficial (API da Meta).';

const coldKey = (numberId: string) => `wa:cold:${numberId}`;

/**
 * Reserva (atômica) uma vaga de contato frio no número. Contato que já tem vaga nas últimas 24 h
 * passa sem gastar outra. Devolve { ok, used, resetsAt } — `resetsAt` = quando a vaga mais
 * antiga completa 24 h.
 */
const CLAIM = `
local now = tonumber(ARGV[1])
local win = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - win)
local ok = 0
if ARGV[4] == '' then
  ok = 0
elseif redis.call('ZSCORE', KEYS[1], ARGV[4]) then
  ok = 1
elseif redis.call('ZCARD', KEYS[1]) < max then
  redis.call('ZADD', KEYS[1], now, ARGV[4])
  redis.call('PEXPIRE', KEYS[1], win)
  ok = 1
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local resets = 0
if oldest[2] then resets = tonumber(oldest[2]) + win end
return { ok, redis.call('ZCARD', KEYS[1]), resets }
`;

async function runClaim(redis: Redis, numberId: string, contactId: string) {
  const [ok, used, resets] = (await redis.eval(CLAIM, 1, coldKey(numberId), Date.now(), COLD_WINDOW_MS, COLD_CONTACTS_PER_DAY, contactId)) as [number, number, number];
  return { ok: ok === 1, used, max: COLD_CONTACTS_PER_DAY, resetsAt: resets ? new Date(resets) : null };
}

export const claimColdContact = (redis: Redis, numberId: string, contactId: string) => runClaim(redis, numberId, contactId);

/**
 * O contato já tem vaga de contato frio no número (um atendente falou primeiro com ele nas últimas
 * 24 h, inclusive disparando um fluxo à mão): a automação dessa conversa pode seguir.
 */
export async function hasColdSlot(redis: Redis, numberId: string, contactId: string) {
  const score = await redis.zscore(coldKey(numberId), contactId);
  return !!score && Date.now() - Number(score) < COLD_WINDOW_MS;
}

/** Só consulta (contato vazio não reserva): quantas vagas o número usou nas últimas 24 h. */
export const coldQuota = (redis: Redis, numberId: string) => runClaim(redis, numberId, '');
