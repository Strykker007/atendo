'use client';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
let accessToken: string | null = null;

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

async function refresh(): Promise<boolean> {
  const r = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!r.ok) return false;
  accessToken = (await r.json()).accessToken;
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
  return res.status === 204 ? (undefined as T) : res.json();
}

export const getAccessToken = () => accessToken;
