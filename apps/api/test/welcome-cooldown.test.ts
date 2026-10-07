import { describe, expect, it } from 'vitest';
import { planInbound } from '../src/modules/flows/hours-gate';

const base = { behavior: 'normal' as const, reply: 'message' as const, paused: false, newAttendance: true, activeRun: false };

describe('boas-vindas: cooldown de 6h', () => {
  it('primeira vez: manda', () => expect(planInbound({ ...base, hoursSinceLastMessage: null }).welcome).toBe(true));
  it('conversou há 2h: não repete a saudação, mas o atendimento segue', () => {
    const p = planInbound({ ...base, hoursSinceLastMessage: 2 });
    expect(p.welcome).toBe(false);
    expect(p.proceed).toBe(true);
  });
  it('conversou há 7h: manda de novo', () => expect(planInbound({ ...base, hoursSinceLastMessage: 7 }).welcome).toBe(true));
});
