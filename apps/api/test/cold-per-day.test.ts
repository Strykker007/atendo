import { describe, expect, it } from 'vitest';
import { COLD_CONTACTS_PER_DAY, resolveSendLimits } from '@atendo/shared';
import { coldQuotaMessage } from '../src/modules/conversations/cold-send';

describe('contatos frios por dia, por número', () => {
  it('padrão 10; o dono pode subir num número (ex.: cobrança da própria empresa)', () => {
    expect(COLD_CONTACTS_PER_DAY).toBe(10);
    expect(resolveSendLimits('evolution', null).coldPerDay).toBe(10);
    expect(resolveSendLimits('evolution', { coldPerDay: 80 }).coldPerDay).toBe(80);
  });

  it('valor fora da faixa (1–500) é ignorado: volta ao padrão', () => {
    expect(resolveSendLimits('evolution', { coldPerDay: 0 }).coldPerDay).toBe(10);
    expect(resolveSendLimits('evolution', { coldPerDay: 10_000 }).coldPerDay).toBe(10);
  });

  it('a mensagem de limite diz o limite daquele número', () => {
    expect(coldQuotaMessage(null, 80)).toContain('falou primeiro com 80 contatos');
    expect(coldQuotaMessage(null)).toContain('falou primeiro com 10 contatos');
  });
});
