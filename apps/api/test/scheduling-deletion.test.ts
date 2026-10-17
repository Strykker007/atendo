import { describe, expect, it } from 'vitest';
import { deletionVerdict } from '../src/modules/scheduling/deletion';

describe('deletionVerdict', () => {
  it('exclui direto o que nunca foi usado', () => {
    expect(deletionVerdict('serviço', { future: 0, past: 0 }, false)).toEqual({ ok: true });
  });
  it('recusa com agendamento futuro, mesmo confirmando o histórico', () => {
    const v = deletionVerdict('profissional', { future: 2, past: 5 }, true);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('has_future');
  });
  it('só histórico: pede confirmação explícita', () => {
    const v = deletionVerdict('profissional', { future: 0, past: 3 }, false);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('has_history');
    expect(deletionVerdict('profissional', { future: 0, past: 3 }, true)).toEqual({ ok: true });
  });
});
