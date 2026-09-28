import { describe, expect, it } from 'vitest';
import { describeProviderError } from '../src/modules/whatsapp/providers/provider-error';

describe('describeProviderError', () => {
  it('string passa direto', () => {
    expect(describeProviderError('Connection Closed', 'padrão')).toBe('Connection Closed');
  });

  it('array de mensagens vira uma linha', () => {
    expect(describeProviderError(['number is required', 'text is required'], 'padrão')).toBe('number is required; text is required');
  });

  it('objeto aninhado devolve a mensagem — era isto que virava "[object Object]" no chat', () => {
    expect(describeProviderError({ message: 'Invalid number' }, 'padrão')).toBe('Invalid number');
    expect(describeProviderError({ error: { message: 'Token expirado' } }, 'padrão')).toBe('Token expirado');
    expect(describeProviderError([{ message: 'a' }, { message: 'b' }], 'padrão')).toBe('a; b');
  });

  it('nenhum resultado contém "[object Object]"', () => {
    for (const entrada of [{ qualquer: { coisa: 1 } }, [{ x: 1 }], { message: {} }, new Date(0)]) {
      expect(describeProviderError(entrada, 'padrão')).not.toContain('[object Object]');
    }
  });

  it('sem nada aproveitável, cai no texto padrão', () => {
    for (const entrada of [undefined, null, '', '   ', {}, [], [null]]) {
      expect(describeProviderError(entrada, 'Evolution 500')).toBe('Evolution 500');
    }
  });

  it('objeto sem campo conhecido devolve o JSON, que ao menos é diagnosticável', () => {
    expect(describeProviderError({ code: 429, retryAfter: 30 }, 'padrão')).toBe('{"code":429,"retryAfter":30}');
  });

  it('trunca resposta gigante para não poluir chat e log', () => {
    expect(describeProviderError({ code: 1, dump: 'x'.repeat(5000) }, 'padrão').length).toBeLessThanOrEqual(300);
  });

  it('não entra em laço com referência circular', () => {
    const a: Record<string, unknown> = { code: 1 };
    a.self = a;
    expect(() => describeProviderError(a, 'padrão')).not.toThrow();
  });
});
