import { describe, expect, it } from 'vitest';
import { deviceLabel, onlineMinutes, sessionEnd } from '../src/modules/auth/access-log';

const t = (hm: string, day = 20) => new Date(`2026-10-${day}T${hm}:00Z`);

describe('sessionEnd', () => {
  it('saída registrada vale; sem saída e sem renovação recente, vale a última renovação', () => {
    expect(sessionEnd({ startedAt: t('08:00'), lastSeenAt: t('09:00'), endedAt: t('09:05') }, t('12:00'))).toEqual({ end: t('09:05'), online: false });
    expect(sessionEnd({ startedAt: t('08:00'), lastSeenAt: t('09:00'), endedAt: null }, t('12:00'))).toEqual({ end: t('09:00'), online: false });
  });

  it('renovou há pouco: está online e vale até agora', () => {
    expect(sessionEnd({ startedAt: t('08:00'), lastSeenAt: t('11:50'), endedAt: null }, t('12:00'))).toEqual({ end: t('12:00'), online: true });
  });
});

describe('onlineMinutes', () => {
  it('duas abas ao mesmo tempo contam uma vez', () => {
    expect(onlineMinutes([{ start: t('08:00'), end: t('10:00') }, { start: t('09:00'), end: t('11:00') }, { start: t('13:00'), end: t('13:30') }], t('00:00'), t('00:00', 21))).toBe(210);
  });

  it('sessão que vira a meia-noite: cada dia leva a sua parte', () => {
    const noite = [{ start: t('19:00'), end: t('07:00', 21) }];
    expect(onlineMinutes(noite, t('00:00'), t('00:00', 21))).toBe(300);
    expect(onlineMinutes(noite, t('00:00', 21), t('00:00', 22))).toBe(420);
  });
});

describe('deviceLabel', () => {
  it('reconhece navegador e sistema', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')).toBe('Chrome no Windows');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari no iOS');
    expect(deviceLabel(null)).toBeNull();
  });
});
