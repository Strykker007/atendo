import { describe, expect, it, vi } from 'vitest';
import { AppLogger } from '../src/common/observability/app-logger';
import { currentContext, enrichContext, runWithContext } from '../src/common/observability/request-context';

/** Captura o que o logger escreveria em stdout/stderr. */
function capture(fn: () => void) {
  const lines: string[] = [];
  const write = (chunk: unknown) => { lines.push(String(chunk)); return true; };
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(write as never);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(write as never);
  try { fn(); } finally { out.mockRestore(); err.mockRestore(); }
  return lines;
}
const json = (lines: string[]) => lines.map((l) => JSON.parse(l));

/** Em produção o formato é json; nos testes pedimos explicitamente para poder afirmar sobre os campos. */
const logger = (context?: string, level?: 'debug' | 'log' | 'warn' | 'error') => new AppLogger(context, { format: 'json', level });

describe('AppLogger', () => {
  it('escreve uma linha JSON por evento', () => {
    const [entry] = json(capture(() => logger('Teste').log('mensagem')));
    expect(entry).toMatchObject({ level: 'log', msg: 'mensagem', context: 'Teste' });
    expect(new Date(entry.time).toString()).not.toBe('Invalid Date');
  });

  it('carrega requestId, tenant e usuário do contexto sem precisar passar em cada chamada', () => {
    const [entry] = json(capture(() => runWithContext({ requestId: 'req-1', tenantId: 'tenant-1', userId: 'user-1' }, () => logger('Teste').log('oi'))));
    expect(entry).toMatchObject({ requestId: 'req-1', tenantId: 'tenant-1', userId: 'user-1' });
  });

  it('inclui dados extras passados como objeto', () => {
    const [entry] = json(capture(() => logger('HTTP').log('GET /conversations 200 12ms', { status: 200, durationMs: 12 })));
    expect(entry).toMatchObject({ status: 200, durationMs: 12 });
  });

  it('entende a chamada do Nest: error(mensagem, stack, contexto)', () => {
    const stack = 'Error: quebrou\n    at algumLugar';
    const [entry] = json(capture(() => logger().error('falhou', stack, 'MeuServico')));
    expect(entry).toMatchObject({ level: 'error', msg: 'falhou', context: 'MeuServico', stack });
  });

  it('aceita um Error direto', () => {
    const [entry] = json(capture(() => logger('X').error(new Error('estourou'))));
    expect(entry.msg).toBe('estourou');
    expect(entry.stack).toContain('Error: estourou');
  });

  it('respeita o nível: debug não sai em "log" e sai em "debug"', () => {
    expect(capture(() => logger('X', 'log').debug('detalhe'))).toHaveLength(0);
    expect(capture(() => logger('X', 'debug').debug('detalhe'))).toHaveLength(1);
    expect(capture(() => logger('X', 'error').warn('aviso'))).toHaveLength(0);
  });

  it('erro e aviso vão para stderr; o resto para stdout', () => {
    const sink = { out: 0, err: 0 };
    const o = vi.spyOn(process.stdout, 'write').mockImplementation(() => (sink.out++, true));
    const e = vi.spyOn(process.stderr, 'write').mockImplementation(() => (sink.err++, true));
    const log = logger('X');
    log.log('a'); log.warn('b'); log.error('c');
    o.mockRestore(); e.mockRestore();
    expect(sink).toEqual({ out: 1, err: 2 });
  });

  it('formato pretty não é JSON e traz o começo do requestId', () => {
    const pretty = new AppLogger('X', { format: 'pretty' });
    const [line] = capture(() => runWithContext({ requestId: 'abcdef12-0000-0000-0000-000000000000' }, () => pretty.log('legível')));
    expect(() => JSON.parse(line)).toThrow();
    expect(line).toContain('legível');
    expect(line).toContain('abcdef12');
  });
});

describe('contexto por requisição', () => {
  it('não vaza entre execuções paralelas', async () => {
    const vistos: (string | undefined)[] = [];
    await Promise.all([
      runWithContext({ requestId: 'a' }, async () => { await new Promise((r) => setTimeout(r, 5)); vistos.push(currentContext()?.requestId); }),
      runWithContext({ requestId: 'b' }, async () => { vistos.push(currentContext()?.requestId); }),
    ]);
    expect(vistos.sort()).toEqual(['a', 'b']);
  });

  it('sobrevive a await (é o que permite logar o tenant no meio de um job)', async () => {
    await runWithContext({ requestId: 'a' }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      enrichContext({ tenantId: 'tenant-1' });
      await new Promise((r) => setTimeout(r, 1));
      expect(currentContext()).toMatchObject({ requestId: 'a', tenantId: 'tenant-1' });
    });
  });

  it('gera requestId quando não vem de fora', () => {
    runWithContext({}, () => expect(currentContext()?.requestId).toMatch(/^[0-9a-f-]{36}$/));
  });

  it('fora de qualquer contexto não quebra — só não há campos', () => {
    expect(currentContext()).toBeUndefined();
    const [entry] = json(capture(() => logger('X').log('sem contexto')));
    expect(entry.requestId).toBeUndefined();
  });
});
