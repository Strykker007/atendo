import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/** `env` é lido na importação, então cada caso recarrega o módulo com o ambiente que quer. */
async function withEnv(vars: Record<string, string | undefined>) {
  vi.resetModules();
  const old: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    old[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import('../src/modules/ai/providers/base-url');
  const usage = await import('../src/modules/ai/ai-usage.service');
  return { ...mod, ...usage, restore: () => { for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : (process.env[k] = v); } };
}

let restore: (() => void) | undefined;
beforeEach(() => { restore = undefined; });
afterEach(() => restore?.());

describe('baseUrlOr', () => {
  it('sem AI_BASE_URL usa o endpoint oficial', async () => {
    const m = await withEnv({ AI_BASE_URL: undefined });
    restore = m.restore;
    expect(m.baseUrlOr('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
  });

  it('com AI_BASE_URL usa o alternativo, sem barra sobrando', async () => {
    const m = await withEnv({ AI_BASE_URL: 'http://localhost:11434/v1/' });
    restore = m.restore;
    expect(m.baseUrlOr('https://api.openai.com/v1')).toBe('http://localhost:11434/v1');
  });
});

describe('isLocalEndpoint', () => {
  it('reconhece máquina local e rede interna', async () => {
    const m = await withEnv({ AI_BASE_URL: undefined });
    restore = m.restore;
    for (const url of ['http://localhost:11434/v1', 'http://127.0.0.1:1234', 'http://192.168.0.10:11434', 'http://10.0.0.5:8000', 'http://mac-do-tiago.local:11434']) {
      expect(m.isLocalEndpoint(url), url).toBe(true);
    }
  });

  it('endpoint na internet não é local', async () => {
    const m = await withEnv({ AI_BASE_URL: undefined });
    restore = m.restore;
    for (const url of ['https://api.openai.com/v1', 'https://api.groq.com/openai/v1', 'https://generativelanguage.googleapis.com/v1beta/openai', '', 'não é url']) {
      expect(m.isLocalEndpoint(url), url).toBe(false);
    }
  });
});

describe('custo por endpoint', () => {
  it('modelo local não gera custo — senão estouraria o teto sem ninguém ter pago', async () => {
    const m = await withEnv({ AI_BASE_URL: 'http://localhost:11434/v1', AI_PRICE_IN_PER_1K: undefined, AI_PRICE_OUT_PER_1K: undefined });
    restore = m.restore;
    expect(m.costOf('llama3.2', 100_000, 50_000)).toBe(0);
  });

  it('preço do ambiente vale para modelo fora da tabela', async () => {
    const m = await withEnv({ AI_BASE_URL: 'https://api.groq.com/openai/v1', AI_PRICE_IN_PER_1K: '0.0001', AI_PRICE_OUT_PER_1K: '0.0002' });
    restore = m.restore;
    expect(m.costOf('llama-3.3-70b', 1000, 1000)).toBeCloseTo(0.0003, 10);
  });

  it('sem preço no ambiente, cai na tabela por modelo', async () => {
    const m = await withEnv({ AI_BASE_URL: undefined, AI_PRICE_IN_PER_1K: undefined, AI_PRICE_OUT_PER_1K: undefined });
    restore = m.restore;
    const { aiCostUsd } = await import('@atendo/shared');
    expect(m.costOf('gpt-4o-mini', 1000, 1000)).toBe(aiCostUsd('gpt-4o-mini', 1000, 1000));
  });
});
