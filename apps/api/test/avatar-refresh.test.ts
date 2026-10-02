import { describe, expect, it } from 'vitest';
import { AVATAR_RETRY_MS, AVATAR_TTL_MS, shouldRefreshAvatar } from '../src/modules/whatsapp/avatar-refresh';

const now = new Date('2026-10-02T12:00:00Z');
const atras = (ms: number) => new Date(now.getTime() - ms);

describe('shouldRefreshAvatar', () => {
  it('contato novo busca na primeira mensagem', () => {
    expect(shouldRefreshAvatar({ avatarUrl: null, avatarCheckedAt: null }, now)).toBe(true);
  });

  it('quem já tem foto só atualiza depois de uma semana', () => {
    // buscar a cada mensagem faria uma chamada ao provider em todo "oi"
    expect(shouldRefreshAvatar({ avatarUrl: 'media/x.jpg', avatarCheckedAt: atras(60_000) }, now)).toBe(false);
    expect(shouldRefreshAvatar({ avatarUrl: 'media/x.jpg', avatarCheckedAt: atras(AVATAR_TTL_MS + 1) }, now)).toBe(true);
  });

  it('quem não tem foto é tentado de novo só no dia seguinte', () => {
    // pode não ter foto, ou escondê-la de desconhecidos: insistir não traria nada
    expect(shouldRefreshAvatar({ avatarUrl: null, avatarCheckedAt: atras(60 * 60_000) }, now)).toBe(false);
    expect(shouldRefreshAvatar({ avatarUrl: null, avatarCheckedAt: atras(AVATAR_RETRY_MS + 1) }, now)).toBe(true);
  });

  it('sem foto tenta de novo mais cedo do que com foto', () => {
    expect(AVATAR_RETRY_MS).toBeLessThan(AVATAR_TTL_MS);
  });
});
