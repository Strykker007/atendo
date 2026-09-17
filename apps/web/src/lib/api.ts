'use client';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
let accessToken: string | null = null;

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

const IMPERSONATE_KEY = 'atendo-impersonate';
/** Dono "entrando como" um cliente: guardado por aba, para sobreviver ao refresh do token. */
export const impersonation = {
  get: (): { tenantId: string; name: string } | null => { try { return JSON.parse(sessionStorage.getItem(IMPERSONATE_KEY) ?? 'null'); } catch { return null; } },
  set: (v: { tenantId: string; name: string } | null) => { try { v ? sessionStorage.setItem(IMPERSONATE_KEY, JSON.stringify(v)) : sessionStorage.removeItem(IMPERSONATE_KEY); } catch { /* ignore */ } },
};

async function refresh(): Promise<boolean> {
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
