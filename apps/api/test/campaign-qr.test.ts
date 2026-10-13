import { describe, expect, it } from 'vitest';
import { decideDispatch, failureStreak, qrDelay, QR_DELAY_MAX_MS, QR_DELAY_MIN_MS, type DispatchInput } from '../src/modules/campaigns/dispatch';
import { normalizePhone } from '../src/modules/campaigns/segmentation.service';

const base: DispatchInput = { now: Date.UTC(2026, 9, 2, 14, 0, 0), status: 'running', businessHoursOnly: true, isOpen: true, dailyRemaining: 200, pending: 100 };

describe('transmissão no QR Code', () => {
  it('manda UMA por vez (o intervalo aleatório fica entre os envios)', () => {
    expect(decideDispatch({ ...base, qr: true })).toEqual({ action: 'send', take: 1 });
  });

  it('teto do dia esgotado espera, não envia', () => {
    expect(decideDispatch({ ...base, qr: true, dailyRemaining: 0 }).action).toBe('wait');
  });

  it('fora do horário espera', () => {
    expect(decideDispatch({ ...base, qr: true, isOpen: false }).action).toBe('wait');
  });

  it('intervalo entre 20 e 60 s', () => {
    expect(qrDelay(() => 0)).toBe(QR_DELAY_MIN_MS);
    expect(qrDelay(() => 1)).toBe(QR_DELAY_MAX_MS);
    for (let i = 0; i < 50; i++) {
      const v = qrDelay();
      expect(v).toBeGreaterThanOrEqual(QR_DELAY_MIN_MS);
      expect(v).toBeLessThanOrEqual(QR_DELAY_MAX_MS);
    }
  });
});

describe('failureStreak', () => {
  it('3 falhas seguidas param', () => {
    expect(failureStreak(['failed', 'failed', 'failed'])).toBe(true);
  });
  it('um sucesso entre elas não para', () => {
    expect(failureStreak(['failed', 'ok', 'failed', 'failed'])).toBe(false);
  });
  it('menos de 3 envios ainda não decide', () => {
    expect(failureStreak(['failed', 'failed'])).toBe(false);
  });
});

describe('normalizePhone (lista importada)', () => {
  it('sem DDI assume Brasil', () => {
    expect(normalizePhone('(11) 99999-8888')).toBe('5511999998888');
    expect(normalizePhone('11 3333-4444')).toBe('551133334444');
  });
  it('com DDI mantém', () => {
    expect(normalizePhone('+55 11 99999-8888')).toBe('5511999998888');
  });
  it('lixo vira null', () => {
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
  });
});
