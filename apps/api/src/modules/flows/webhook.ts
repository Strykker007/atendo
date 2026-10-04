import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Ação "Chamar webhook" do fluxo. A URL é digitada pelo cliente, então o servidor não pode
 * virar ponte para a rede interna (SSRF): só http/https, porta padrão, e nenhum endereço
 * privado, de loopback ou link-local — conferido depois de resolver o DNS. Redirecionamento
 * não é seguido, senão bastaria um 302 para dentro da rede.
 */

const MAX_BODY = 2_000;
/** Headers que o cliente não escolhe: o fetch calcula, e mexer neles abre brecha (host = SSRF por vhost). */
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade', 'te', 'trailer', 'proxy-authorization', 'proxy-connection']);

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('ff');
}

/** Valida a URL e devolve o objeto pronto. Lança com mensagem em português para a UI/log. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('URL do webhook inválida');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('O webhook precisa ser http ou https');
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('O webhook só pode usar as portas 80 ou 443');
  if (url.username || url.password) throw new Error('Não coloque usuário/senha na URL do webhook');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('O webhook aponta para um endereço interno');
  return url;
}

export interface WebhookRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** já interpolados; nome vazio ou proibido é ignorado */
  headers: { key: string; value: string }[];
  /** já pronto; ignorado em GET/DELETE */
  body?: string;
  timeoutMs: number;
}

/**
 * Chama o webhook. Lança (com mensagem em português) em rede/DNS, tempo limite, endereço interno
 * ou status fora de 2xx — o motor transforma isso na saída "Erro".
 */
export async function callWebhook(raw: string, req: WebhookRequest): Promise<{ status: number; body: string }> {
  const url = await assertPublicUrl(raw);
  const headers: Record<string, string> = { 'user-agent': 'Atendo-Flows/1' };
  for (const h of req.headers) {
    const key = h.key.trim().toLowerCase();
    if (!key || !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(key) || FORBIDDEN_HEADERS.has(key)) continue;
    headers[key] = h.value.replace(/[\r\n]/g, ' ');
  }
  const withBody = req.method !== 'GET' && req.method !== 'DELETE' && req.body !== undefined;
  if (withBody && !headers['content-type']) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method: req.method, headers, body: withBody ? req.body : undefined, redirect: 'manual', signal: AbortSignal.timeout(req.timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new Error(`webhook não respondeu em ${Math.round(req.timeoutMs / 1000)} s`);
    throw new Error(`webhook inacessível: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = (await res.text().catch(() => '')).slice(0, MAX_BODY);
  if (!res.ok) throw new Error(`webhook respondeu ${res.status}`);
  return { status: res.status, body };
}
