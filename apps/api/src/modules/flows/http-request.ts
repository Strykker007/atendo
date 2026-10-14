import { HTTP_MAX_RESPONSE_BYTES, HTTP_VAR_MAX, WEBHOOK_DEFAULT_TIMEOUT_SEC, WEBHOOK_MAX_TIMEOUT_SEC, jsonValueText, readJsonPath, type HttpNode } from '@atendo/shared';
import { interpolate, jsonEscape, type InterpolateCtx } from './answer';
import { callWebhook } from './webhook';

export interface HttpOutcome {
  ok: boolean;
  /** 0 = não respondeu (rede, tempo limite, endereço interno) */
  status: number;
  body: string;
  /** JSON lido (undefined = corpo vazio ou não é JSON) */
  json?: unknown;
  /** variáveis a gravar no run: mapeamentos, status e corpo */
  vars: Record<string, string>;
  /** por que caiu em "Erro" (vai para o log do run e para o teste do editor) */
  error?: string;
  /** caminho mapeado que não existe na resposta (não é erro: a variável fica vazia) */
  missing: string[];
}

/**
 * Executa o bloco "API externa" (docs/fluxos.md#api-externa): monta a requisição com as
 * {{variáveis}}, chama pela mesma porta do webhook (só http/https público, sem redirecionamento)
 * e lê a resposta. Puro em relação ao run: devolve as variáveis e quem grava é o motor — o teste
 * do editor usa a mesma função sem tocar em nada.
 *
 * Erro = não respondeu, status fora de 2xx ou, com mapeamentos, resposta que não é JSON. No
 * erro, as variáveis mapeadas ficam vazias (nunca sobra valor de uma chamada anterior).
 */
export async function runHttpRequest(d: HttpNode['data'], ctx: InterpolateCtx): Promise<HttpOutcome> {
  const method = d.method ?? 'GET';
  const headers = (d.headers ?? []).map((h) => ({ key: h.key, value: interpolate(h.value ?? '', ctx) }));
  const contentType = headers.find((h) => h.key.trim().toLowerCase() === 'content-type')?.value ?? 'application/json';
  if (!headers.some((h) => h.key.trim().toLowerCase() === 'accept')) headers.push({ key: 'accept', value: 'application/json' });
  const body = d.body?.trim() ? interpolate(d.body, ctx, /json/i.test(contentType) ? jsonEscape : undefined) : undefined;
  const timeoutSec = Math.min(WEBHOOK_MAX_TIMEOUT_SEC, Math.max(1, Number(d.timeoutSec) || WEBHOOK_DEFAULT_TIMEOUT_SEC));
  const mappings = (d.mappings ?? []).filter((m) => m.path?.trim() && m.varName);

  const vars: Record<string, string> = {};
  const vazio = () => { for (const m of mappings) vars[m.varName] = ''; };
  let status = 0;
  let text = '';
  let error: string | undefined;
  let json: unknown;
  const missing: string[] = [];
  try {
    const res = await callWebhook(interpolate(d.url ?? '', ctx, encodeURIComponent), { method, headers, body, timeoutMs: timeoutSec * 1000, maxBodyBytes: HTTP_MAX_RESPONSE_BYTES, acceptAnyStatus: true });
    status = res.status;
    text = res.body;
    if (text.trim()) { try { json = JSON.parse(text); } catch { json = undefined; } }
    if (status < 200 || status >= 300) error = `a API respondeu ${status}`;
    else if (mappings.length && json === undefined) error = 'a resposta não é JSON (não dá para ler os campos)';
  } catch (err) {
    error = (err instanceof Error ? err.message : String(err)).replace(/^webhook/, 'a API');
  }
  if (error) vazio();
  else {
    for (const m of mappings) {
      const v = readJsonPath(json, m.path);
      if (v === undefined) missing.push(m.path);
      vars[m.varName] = jsonValueText(v);
    }
  }
  if (d.statusVar) vars[d.statusVar] = String(status);
  if (d.responseVar) vars[d.responseVar] = text.slice(0, HTTP_VAR_MAX);
  return { ok: !error, status, body: text, json, vars, error, missing };
}
