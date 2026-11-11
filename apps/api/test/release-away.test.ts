import { describe, expect, it } from 'vitest';
import { awayDecision, releasableRole } from '../src/modules/auto-reassign/release-away';

const MIN = 60_000;

describe('saiu do plantão: quando devolver os atendimentos', () => {
  it('presente (painel aberto no turno, ou em pausa) zera o relógio', () => {
    expect(awayDecision(true, null, 0, 30)).toBe('clear');
    expect(awayDecision(true, 0, 100 * MIN, 30)).toBe('clear');
  });

  it('acabou de sumir: começa a contar', () => {
    expect(awayDecision(false, null, 10 * MIN, 30)).toBe('mark');
    expect(awayDecision(false, Number.NaN, 10 * MIN, 30)).toBe('mark');
  });

  it('dentro do tempo espera; no tempo devolve', () => {
    expect(awayDecision(false, 0, 29 * MIN, 30)).toBe('wait');
    expect(awayDecision(false, 0, 30 * MIN, 30)).toBe('release');
    expect(awayDecision(false, 0, 90 * MIN, 30)).toBe('release');
  });

  it('o admin da conta segura os dele; atendente e gerente devolvem', () => {
    expect(releasableRole('agent')).toBe(true);
    expect(releasableRole('manager')).toBe(true);
    expect(releasableRole('tenant_admin')).toBe(false);
    expect(releasableRole('super_admin')).toBe(false);
  });
});
