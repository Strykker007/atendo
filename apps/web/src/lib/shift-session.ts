'use client';
import { create } from 'zustand';

/**
 * Estado do turno da sessão (docs/escalas.md#fim-de-turno), lido do próprio access token:
 * `shiftEndsAt` = quando trava; `locked` = já travada (passagem de turno). Quem decide de
 * verdade é a API (o `JwtAuthGuard` recusa com `SHIFT_ENDED`); aqui é para a tela reagir na
 * hora e não ficar disparando pedidos que vão ser recusados.
 */
interface ShiftSession {
  locked: boolean;
  /** epoch (ms) do fim do turno/liberação; null = sem escala */
  endsAt: number | null;
  /** epoch (ms) em que a passagem acaba e a sessão cai de vez */
  lockedUntil: number | null;
  /** epoch (ms) do fim real do turno quando há tolerância para sair: daqui até `endsAt` corre o contador */
  graceFrom: number | null;
}
export const useShiftSession = create<ShiftSession>(() => ({ locked: false, endsAt: null, lockedUntil: null, graceFrom: null }));

function claims(t: string): { shiftEndsAt?: number; locked?: boolean; lockedUntil?: number; graceFrom?: number } {
  try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}

/** Token novo: atualiza o estado do turno. Token sem trava destrava (liberação aprovada, turno estendido). */
export function applyShiftToken(t: string | null) {
  if (!t) { useShiftSession.setState({ locked: false, endsAt: null, lockedUntil: null, graceFrom: null }); return; }
  const c = claims(t);
  const endsAt = c.shiftEndsAt ? c.shiftEndsAt * 1000 : null;
  useShiftSession.setState({
    locked: !!c.locked || (!!endsAt && Date.now() >= endsAt),
    endsAt,
    lockedUntil: c.lockedUntil ? c.lockedUntil * 1000 : null,
    graceFrom: c.graceFrom ? c.graceFrom * 1000 : null,
  });
}

/** A API disse que o turno acabou (corte imediato pelo gestor, ou o relógio passou). */
export const markShiftLocked = () => useShiftSession.setState({ locked: true });

/** Rotas que funcionam com o turno encerrado — as outras nem saem do navegador. */
export const allowedWhileLocked = (path: string) => path.startsWith('/auth/') || path.startsWith('/me/shift');
