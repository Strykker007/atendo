import { afterEach, describe, expect, it, vi } from 'vitest';
import { postWithRetry, providerError } from '../src/modules/ai/providers/retry';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('providerError', () => {
  it('lê o erro da OpenAI/Anthropic e o do Gemini (que vem dentro de uma lista)', () => {
    expect(providerError({ error: { message: 'sem crédito', code: 'insufficient_quota' } })).toEqual({ message: 'sem crédito', code: 'insufficient_quota' });
    expect(providerError([{ error: { code: 503, message: 'high demand', status: 'UNAVAILABLE' } }]).message).toBe('high demand');
    expect(providerError({}).message).toBeUndefined();
  });
});

describe('postWithRetry', () => {
  it('tenta de novo quando o fornecedor está sobrecarregado e devolve o sucesso', async () => {
    const f = vi.fn().mockResolvedValueOnce(reply(503, [{ error: { message: 'high demand' } }])).mockResolvedValueOnce(reply(200, { ok: 1 }));
    vi.stubGlobal('fetch', f);
    const { res, json } = await postWithRetry('http://x', { headers: {}, body: '{}' }, 20_000);
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('falta de crédito não repete', async () => {
    const f = vi.fn().mockResolvedValue(reply(429, { error: { message: 'no credits', code: 'insufficient_quota' } }));
    vi.stubGlobal('fetch', f);
    const { res } = await postWithRetry('http://x', { headers: {}, body: '{}' }, 20_000);
    expect(res.status).toBe(429);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('erro de chave (401) não repete; sobrecarga para em 3 tentativas', async () => {
    const f401 = vi.fn().mockResolvedValue(reply(401, { error: { message: 'invalid key' } }));
    vi.stubGlobal('fetch', f401);
    await postWithRetry('http://x', { headers: {}, body: '{}' }, 20_000);
    expect(f401).toHaveBeenCalledTimes(1);

    const f503 = vi.fn().mockResolvedValue(reply(503, {}));
    vi.stubGlobal('fetch', f503);
    const { res } = await postWithRetry('http://x', { headers: {}, body: '{}' }, 20_000);
    expect(res.status).toBe(503);
    expect(f503).toHaveBeenCalledTimes(3);
  });

  it('sem prazo sobrando não espera para repetir', async () => {
    const f = vi.fn().mockResolvedValue(reply(503, {}));
    vi.stubGlobal('fetch', f);
    await postWithRetry('http://x', { headers: {}, body: '{}' }, 2_000);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
