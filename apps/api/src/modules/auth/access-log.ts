/**
 * Conta do registro de acessos (docs/registro-de-acessos.md). Pura de propósito: sessão que
 * atravessa a meia-noite, duas abas/aparelhos ao mesmo tempo e sessão ainda aberta precisam ser
 * testáveis sem banco.
 */

/** Sem renovação há mais que isto (access token dura 15 min) e sem saída registrada = fechou o navegador. */
export const ONLINE_STALE_MS = 20 * 60_000;

export interface SessionTimes {
  startedAt: Date;
  lastSeenAt: Date;
  endedAt: Date | null;
}

/** Até quando a sessão vale: a saída registrada; senão a última renovação; ainda viva = agora. */
export function sessionEnd(s: SessionTimes, now: Date): { end: Date; online: boolean } {
  if (s.endedAt) return { end: s.endedAt, online: false };
  const online = now.getTime() - s.lastSeenAt.getTime() < ONLINE_STALE_MS;
  return { end: online ? now : s.lastSeenAt, online };
}

/**
 * Minutos online dentro de [from, to): une os intervalos antes de somar — duas abas ou celular
 * + computador no mesmo horário contam uma vez só.
 */
export function onlineMinutes(spans: { start: Date; end: Date }[], from: Date, to: Date): number {
  const cut = spans
    .map((s) => [Math.max(s.start.getTime(), from.getTime()), Math.min(s.end.getTime(), to.getTime())] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of cut) {
    if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
    else {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    }
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round(total / 60_000);
}

/** "Chrome no Windows" a partir do user-agent — o suficiente para o gestor reconhecer o aparelho. */
export function deviceLabel(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  if (browser && os) return `${browser} no ${os}`;
  return browser ?? os ?? 'Outro navegador';
}
