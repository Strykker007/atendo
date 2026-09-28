import { env } from '../../../config/env';

/** `AI_BASE_URL` quando definida (sem barra no fim), senão o endpoint oficial do adapter. */
export const baseUrlOr = (official: string) => (env.AI_BASE_URL || official).replace(/\/+$/, '');

/**
 * Endpoint na própria máquina/rede (Ollama, LM Studio, vLLM): não há fatura do fornecedor,
 * então o custo é zero. Sem isto, um modelo local cairia no "assume o mais caro" e
 * estouraria o teto de gasto do tenant sem ninguém ter pago nada.
 */
export function isLocalEndpoint(url = env.AI_BASE_URL) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host.endsWith('.local') || host.endsWith('.localhost') || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  } catch {
    return false;
  }
}
