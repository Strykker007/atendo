'use client';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
let accessToken: string | null = null;

/**
 * Quem precisa saber que o token chegou.
 *
 * O socket do tempo real é montado uma vez, na montagem do layout, e naquele instante o token
 * ainda não existe: ele vem de uma chamada de refresh. Sem este aviso, o socket simplesmente
 * não era criado — e o painel só recebia mensagem nova depois de um F5 que, por sorte de
 * tempo, caísse do outro lado da corrida.
 */
const ouvintes = new Set<(t: string | null) => void>();
export const onAccessToken = (fn: (t: string | null) => void) => {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
};

export const setAccessToken = (t: string | null) => {
  const mudou = accessToken !== t;
  accessToken = t;
  if (mudou) for (const fn of ouvintes) fn(t);
};

const IMPERSONATE_KEY = 'atendo-impersonate';
/** Dono "entrando como" um cliente: guardado por aba, para sobreviver ao refresh do token. */
export const impersonation = {
  get: (): { tenantId: string; name: string } | null => { try { return JSON.parse(sessionStorage.getItem(IMPERSONATE_KEY) ?? 'null'); } catch { return null; } },
  set: (v: { tenantId: string; name: string } | null) => { try { v ? sessionStorage.setItem(IMPERSONATE_KEY, JSON.stringify(v)) : sessionStorage.removeItem(IMPERSONATE_KEY); } catch { /* ignore */ } },
};

/**
 * Renovação com trava de concorrência.
 *
 * O painel dispara várias chamadas em paralelo; quando o token expira, TODAS tomam 401 ao
 * mesmo tempo. Sem esta trava, cada uma chamaria /auth/refresh com o mesmo cookie — e como o
 * servidor rotaciona o refresh, a primeira vence e as demais apresentam um token já revogado,
 * derrubando a sessão inteira a cada 15 minutos.
 */
let inFlight: Promise<boolean> | null = null;
function refresh(): Promise<boolean> {
  inFlight ??= doRefresh().finally(() => { inFlight = null; });
  return inFlight;
}

async function doRefresh(): Promise<boolean> {
  const r = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!r.ok) return false;
  accessToken = (await r.json()).accessToken;
  // se o dono estava dentro de um cliente, volta para lá com um token novo de impersonação
  const imp = impersonation.get();
  if (imp) {
    const i = await fetch(`${API}/tenants/${imp.tenantId}/impersonate`, { method: 'POST', credentials: 'include', headers: { Authorization: `Bearer ${accessToken}` } });
    if (i.ok) accessToken = (await i.json()).accessToken;
    else impersonation.set(null);
  }
  return true;
}

/** fetch com Bearer + refresh automático em 401 (uma tentativa). */
export async function api<T = unknown>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(accessToken && { Authorization: `Bearer ${accessToken}` }), ...init.headers },
  });
  if (res.status === 401 && retry && (await refresh())) return api<T>(path, init, false);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Erro ${res.status}`);
  }
  // corpo vazio (204, ou o Nest devolvendo `null`) vira null em vez de erro de JSON
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const getAccessToken = () => accessToken;
