import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Ação "Chamar webhook" do fluxo. A URL é digitada pelo cliente, então o servidor não pode
 * virar ponte para a rede interna (SSRF): só http/https, porta padrão, e nenhum endereço
 * privado, de loopback ou link-local — conferido depois de resolver o DNS. Redirecionamento
 * não é seguido, senão bastaria um 302 para dentro da rede.
 */

const TIMEOUT_MS = 8_000;
const MAX_BODY = 2_000;

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

export async function callWebhook(raw: string, payload: unknown): Promise<{ status: number; body: string }> {
  const url = await assertPublicUrl(raw);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Atendo-Flows/1' },
    body: JSON.stringify(payload),
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.text().catch(() => '')).slice(0, MAX_BODY);
  if (!res.ok) throw new Error(`webhook respondeu ${res.status}`);
  return { status: res.status, body };
}
