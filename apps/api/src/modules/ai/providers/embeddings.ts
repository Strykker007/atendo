import { env } from '../../../config/env';
import { isLocalEndpoint } from './base-url';
import { postWithRetry, providerError } from './retry';

/** lote por chamada: a OpenAI aceita 2048, mas lote menor falha menos por tamanho */
const BATCH = 64;
/**
 * Endpoint local (Ollama em CPU): cada trecho leva segundos (docs/agente-ia.md#embeddings-locais).
 * Lote pequeno e prazo longo por lote — com 64 trechos e 30 s o lote nunca terminaria.
 */
const LOCAL_BATCH = 4;
const LOCAL_TIMEOUT_MS = 180_000;
const local = () => isLocalEndpoint(env.AI_EMBED_BASE_URL);

const base = () => env.AI_EMBED_BASE_URL.replace(/\/+$/, '');

/** Busca por significado ligada: tem chave, ou o endpoint é local (Ollama). */
export const embeddingsOn = () => !!env.AI_EMBED_API_KEY || isLocalEndpoint(env.AI_EMBED_BASE_URL);

/** modelo + dimensões: vetor de outro modelo/tamanho não se compara — o job refaz */
export const embedModel = () => (embedDims() ? `${env.AI_EMBED_MODEL}:${env.AI_EMBED_DIMENSIONS}` : env.AI_EMBED_MODEL);
/** Modelo local (bge-m3 etc.) devolve o tamanho dele: `dimensions` só vale nos fornecedores que encolhem o vetor. */
const embedDims = () => (local() ? 0 : env.AI_EMBED_DIMENSIONS);

/** Custo em USD de `tokens` de embedding (endpoint local = 0). */
export const embedCostUsd = (tokens: number) => (isLocalEndpoint(env.AI_EMBED_BASE_URL) ? 0 : (tokens / 1_000_000) * env.AI_EMBED_PRICE_PER_1M);

/**
 * `/embeddings` no formato da OpenAI (OpenAI, Gemini compatível, Ollama). Devolve um vetor por
 * texto, na mesma ordem, e os tokens gastos. Lança com a mensagem do fornecedor.
 */
export async function embed(texts: string[], timeoutMs?: number): Promise<{ vectors: number[][]; tokens: number }> {
  const vectors: number[][] = [];
  let tokens = 0;
  const batch = local() ? LOCAL_BATCH : BATCH;
  const timeout = timeoutMs ?? (local() ? LOCAL_TIMEOUT_MS : 30_000);
  for (let i = 0; i < texts.length; i += batch) {
    const input = texts.slice(i, i + batch);
    const { res, json } = await postWithRetry(
      `${base()}/embeddings`,
      {
        headers: { ...(env.AI_EMBED_API_KEY && { Authorization: `Bearer ${env.AI_EMBED_API_KEY}` }), 'content-type': 'application/json' },
        body: JSON.stringify({ model: env.AI_EMBED_MODEL, input, ...(embedDims() && { dimensions: embedDims() }) }),
      },
      timeout,
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
