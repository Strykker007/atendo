/** Status de sobrecarga/instabilidade do fornecedor: vale tentar de novo (529 = Anthropic "overloaded"). */
export const RETRYABLE: ReadonlySet<number> = new Set([429, 500, 502, 503, 529]);
/** espera antes da 2ª e da 3ª tentativa */
const BACKOFF_MS = [700, 1800];
/** só tenta de novo se sobrar pelo menos isto do prazo — o contato está esperando */
const MIN_LEFT_MS = 3000;

/** Corpo de erro dos fornecedores: `{error:{message}}` (OpenAI/Anthropic) ou `[{error:{…}}]` (Gemini compatível). */
export function providerError(json: any): { message?: string; code?: string } {
  const e = (Array.isArray(json) ? json[0] : json)?.error;
  return { message: typeof e?.message === 'string' ? e.message : undefined, code: e?.code ?? e?.type ?? e?.status };
}

/**
 * POST JSON com novas tentativas curtas quando o fornecedor está sobrecarregado (503/529/429),
 * dentro do mesmo prazo total (`timeoutMs`). Falta de crédito (429 `insufficient_quota`) não é
 * sobrecarga: volta na hora. Timeout não repete — o prazo já acabou.
 */
export async function postWithRetry(url: string, init: { headers: Record<string, string>; body: string }, timeoutMs: number, retryable: ReadonlySet<number> = RETRYABLE) {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: init.headers, body: init.body, signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    const json = (await res.json().catch(() => ({}))) as any;
    if (res.ok || !retryable.has(res.status)) return { res, json };
    const { code } = providerError(json);
    const wait = BACKOFF_MS[attempt];
    if (code === 'insufficient_quota' || wait === undefined || deadline - Date.now() - wait < MIN_LEFT_MS) return { res, json };
    await new Promise((r) => setTimeout(r, wait));
  }
}
