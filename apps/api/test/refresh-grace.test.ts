import { describe, expect, it } from 'vitest';
import { refreshAcceptable, REFRESH_GRACE_MS } from '../src/modules/auth/refresh-grace';

const now = new Date('2026-10-02T12:00:00Z');
const futuro = new Date('2026-11-01T12:00:00Z');
const atras = (ms: number) => new Date(now.getTime() - ms);

describe('refreshAcceptable', () => {
  it('token ativo e dentro da validade passa', () => {
    expect(refreshAcceptable({ revokedAt: null, expiresAt: futuro }, now)).toBe(true);
  });

  it('expirado nunca passa, mesmo sem ter sido revogado', () => {
    expect(refreshAcceptable({ revokedAt: null, expiresAt: atras(1) }, now)).toBe(false);
  });

  it('recém-rotacionado ainda passa — é a corrida de duas abas renovando juntas', () => {
    expect(refreshAcceptable({ revokedAt: atras(200), expiresAt: futuro }, now)).toBe(true);
    expect(refreshAcceptable({ revokedAt: atras(REFRESH_GRACE_MS), expiresAt: futuro }, now)).toBe(true);
  });

  it('passada a carência, não passa mais — a rotação volta a proteger', () => {
    expect(refreshAcceptable({ revokedAt: atras(REFRESH_GRACE_MS + 1), expiresAt: futuro }, now)).toBe(false);
    expect(refreshAcceptable({ revokedAt: atras(60 * 60_000), expiresAt: futuro }, now)).toBe(false);
  });

  it('logout vale na hora quando a carência é zero', () => {
    // o logout explícito não deveria deixar 30s de brecha; quem chama pode zerar a janela
    expect(refreshAcceptable({ revokedAt: atras(1), expiresAt: futuro }, now, 0)).toBe(false);
  });

  it('expirado E revogado continua sem passar', () => {
    expect(refreshAcceptable({ revokedAt: atras(100), expiresAt: atras(1) }, now)).toBe(false);
  });
});
