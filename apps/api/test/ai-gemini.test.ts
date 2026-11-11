import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiBusyError, modelChain, msUntilPacificMidnight, parseGeminiQuota } from '../src/modules/ai/ai-busy';
import { GeminiProvider } from '../src/modules/ai/providers/gemini.provider';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

/** Redis de mentira: só o que o provider usa (set PX, pttl, exists). */
function fakeRedis() {
  const store = new Map<string, number>();
  return {
    store,
    async set(k: string, _v: string, _px: string, ms: number) { store.set(k, Date.now() + ms); return 'OK'; },
    async pttl(k: string) { const t = store.get(k); return t ? Math.max(0, t - Date.now()) : -2; },
    async exists(k: string) { return store.has(k) ? 1 : 0; },
  };
}
const req = { system: 's', messages: [{ role: 'user' as const, content: 'oi' }], maxTokens: 50, timeoutMs: 20_000, apiKey: 'AIza-teste-0000000000000000' };
const perMinute = [{ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }, { retryDelay: '30s' }] } }];
const perDay = [{ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }];
const ok = (model: string) => reply(200, { model, choices: [{ message: { content: 'resposta' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

describe('cota do Gemini', () => {
  it('lê a espera por minuto (retryDelay ou a frase) e a cota do dia', () => {
    expect(parseGeminiQuota(perMinute)).toEqual({ daily: false, retryAfterMs: 30_000 });
    expect(parseGeminiQuota({ error: { message: 'Please retry in 12.4s.' } }).retryAfterMs).toBe(12_400);
    expect(parseGeminiQuota({}).retryAfterMs).toBe(60_000);
    expect(parseGeminiQuota(perDay).daily).toBe(true);
  });

  it('meia-noite do Pacífico: 07:00 UTC no verão deles, 08:00 no inverno (+1 min de folga)', () => {
    expect(msUntilPacificMidnight(new Date('2026-07-01T06:00:00Z'))).toBe(3_600_000 + 60_000);
    expect(msUntilPacificMidnight(new Date('2026-12-01T07:00:00Z'))).toBe(3_600_000 + 60_000);
  });

  it('ordem dos modelos: o escolhido primeiro, sem repetir', () => {
    expect(modelChain('b', ['a', 'b'])).toEqual(['b', 'a']);
    expect(modelChain('x', ['a', 'b'])).toEqual(['x', 'a', 'b']);
  });
});

describe('GeminiProvider', () => {
  it('modelo no limite: passa para o próximo na mesma rodada e lembra do limite', async () => {
    const redis = fakeRedis();
    const f = vi.fn().mockResolvedValueOnce(reply(429, perMinute)).mockResolvedValueOnce(ok('gemini-2.5-flash-lite'));
    vi.stubGlobal('fetch', f);
    const p = new GeminiProvider(redis as never);
    const out = await p.complete(req);
    expect(out.model).toBe('gemini-2.5-flash-lite');
    expect(f).toHaveBeenCalledTimes(2);
    // próxima rodada nem tenta o modelo que está esfriando
    f.mockResolvedValueOnce(ok('gemini-2.5-flash-lite'));
    await p.complete(req);
    expect(JSON.parse(f.mock.calls[2][1].body).model).toBe('gemini-2.5-flash-lite');
  });

  it('todos no limite: AiBusyError com a menor espera; cota do dia marca daily', async () => {
    const f = vi.fn().mockResolvedValueOnce(reply(429, perMinute)).mockResolvedValueOnce(reply(429, perDay));
    vi.stubGlobal('fetch', f);
    const err = await new GeminiProvider(fakeRedis() as never).complete(req).catch((e) => e);
    expect(err).toBeInstanceOf(AiBusyError);
    expect(err.daily).toBe(false);
    expect(err.retryAfterMs).toBe(30_000);

    const f2 = vi.fn().mockImplementation(async () => reply(429, perDay));
    vi.stubGlobal('fetch', f2);
    const err2 = await new GeminiProvider(fakeRedis() as never).complete(req).catch((e) => e);
    expect(err2.daily).toBe(true);
  });

  it('chave inválida (400 "API key not valid") vira mensagem clara e não troca de modelo', async () => {
    const f = vi.fn().mockImplementation(async () => reply(400, [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }]));
    vi.stubGlobal('fetch', f);
    await expect(new GeminiProvider(fakeRedis() as never).complete(req)).rejects.toThrow(/Chave do Gemini recusada/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
