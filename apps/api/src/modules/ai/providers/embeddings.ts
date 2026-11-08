import { env } from '../../../config/env';
import { isLocalEndpoint } from './base-url';
import { postWithRetry, providerError } from './retry';

/** lote por chamada: a OpenAI aceita 2048, mas lote menor falha menos por tamanho */
const BATCH = 64;

const base = () => env.AI_EMBED_BASE_URL.replace(/\/+$/, '');

/** Busca por significado ligada: tem chave, ou o endpoint é local (Ollama). */
export const embeddingsOn = () => !!env.AI_EMBED_API_KEY || isLocalEndpoint(env.AI_EMBED_BASE_URL);

/** modelo + dimensões: vetor de outro modelo/tamanho não se compara — o job refaz */
export const embedModel = () => (env.AI_EMBED_DIMENSIONS ? `${env.AI_EMBED_MODEL}:${env.AI_EMBED_DIMENSIONS}` : env.AI_EMBED_MODEL);

/** Custo em USD de `tokens` de embedding (endpoint local = 0). */
export const embedCostUsd = (tokens: number) => (isLocalEndpoint(env.AI_EMBED_BASE_URL) ? 0 : (tokens / 1_000_000) * env.AI_EMBED_PRICE_PER_1M);

/**
 * `/embeddings` no formato da OpenAI (OpenAI, Gemini compatível, Ollama). Devolve um vetor por
 * texto, na mesma ordem, e os tokens gastos. Lança com a mensagem do fornecedor.
 */
export async function embed(texts: string[], timeoutMs = 30_000): Promise<{ vectors: number[][]; tokens: number }> {
  const vectors: number[][] = [];
  let tokens = 0;
  for (let i = 0; i < texts.length; i += BATCH) {
    const input = texts.slice(i, i + BATCH);
    const { res, json } = await postWithRetry(
      `${base()}/embeddings`,
      {
        headers: { ...(env.AI_EMBED_API_KEY && { Authorization: `Bearer ${env.AI_EMBED_API_KEY}` }), 'content-type': 'application/json' },
        body: JSON.stringify({ model: env.AI_EMBED_MODEL, input, ...(env.AI_EMBED_DIMENSIONS && { dimensions: env.AI_EMBED_DIMENSIONS }) }),
      },
      timeoutMs,
    );
    if (!res.ok) throw new Error(providerError(json).message ?? `embeddings ${res.status}`);
    const data = (Array.isArray(json.data) ? json.data : []) as { index?: number; embedding: number[] }[];
    if (data.length !== input.length) throw new Error('embeddings: o fornecedor devolveu menos vetores que textos');
    data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).forEach((d) => vectors.push(d.embedding));
    // sem `usage` (alguns compatíveis não mandam): estima ~4 caracteres por token
    tokens += json.usage?.prompt_tokens ?? Math.ceil(input.join('').length / 4);
  }
  return { vectors, tokens };
}
