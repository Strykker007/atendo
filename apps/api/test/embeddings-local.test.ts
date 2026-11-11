import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

/** carrega embeddings.ts com o ambiente dado (env.ts lê process.env na importação) */
async function load(baseUrl: string) {
  vi.stubEnv('AI_EMBED_BASE_URL', baseUrl);
  vi.stubEnv('AI_EMBED_MODEL', 'bge-m3');
  vi.stubEnv('AI_EMBED_DIMENSIONS', '512');
  vi.resetModules();
  return import('../src/modules/ai/providers/embeddings');
}
const ok = (n: number) => new Response(JSON.stringify({ data: Array.from({ length: n }, (_, index) => ({ index, embedding: [1, 0] })) }), { status: 200 });

describe('embeddings locais (Ollama em CPU)', () => {
  it('serviço do compose (http://ollama:11434) é local: liga sem chave, lote de 4, sem "dimensions"', async () => {
    const m = await load('http://ollama:11434/v1');
    const f = vi.fn(async (_url: string, init: { body: string }) => ok(JSON.parse(init.body).input.length));
    vi.stubGlobal('fetch', f);
    expect(m.embeddingsOn()).toBe(true);
    expect(m.embedModel()).toBe('bge-m3');
    const { vectors } = await m.embed(Array.from({ length: 10 }, (_, i) => `t${i}`));
    expect(vectors).toHaveLength(10);
    expect(f).toHaveBeenCalledTimes(3); // 4 + 4 + 2
    expect(JSON.parse(f.mock.calls[0][1].body)).not.toHaveProperty('dimensions');
    expect(m.embedCostUsd(1000)).toBe(0);
  });

  it('fornecedor externo continua com lote de 64 e dimensions', async () => {
    const m = await load('https://api.openai.com/v1');
    const f = vi.fn(async (_url: string, init: { body: string }) => ok(JSON.parse(init.body).input.length));
    vi.stubGlobal('fetch', f);
    await m.embed(Array.from({ length: 10 }, (_, i) => `t${i}`));
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.mock.calls[0][1].body).dimensions).toBe(512);
    expect(m.embedModel()).toBe('bge-m3:512');
  });
});
