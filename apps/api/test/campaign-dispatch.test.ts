import { describe, expect, it } from 'vitest';
import { afterBatch, BATCH_INTERVAL_MS, BATCH_SIZE, decideDispatch, eligible, IDLE_RETRY_MS, isOptOut, type DispatchInput } from '../src/modules/campaigns/dispatch';

const NOW = Date.UTC(2026, 9, 2, 14, 0, 0);
const base: DispatchInput = { now: NOW, status: 'running', businessHoursOnly: false, isOpen: true, dailyRemaining: 1000, pending: 100 };
const d = (over: Partial<DispatchInput> = {}) => decideDispatch({ ...base, ...over });

describe('decideDispatch', () => {
  it('manda um lote limitado pelo BATCH_SIZE', () => {
    expect(d()).toEqual({ action: 'send', take: BATCH_SIZE });
  });

  it('nunca passa do que ainda cabe no teto do número', () => {
    expect(d({ dailyRemaining: 7 })).toEqual({ action: 'send', take: 7 });
  });

  it('nunca manda mais do que tem na fila', () => {
    expect(d({ pending: 3 })).toEqual({ action: 'send', take: 3 });
  });

  it.each([['paused'], ['canceled']] as const)('%s para o disparo', (status) => {
    expect(d({ status })).toMatchObject({ action: 'stop' });
  });

  it('fila vazia termina — mesmo fora do horário', () => {
    // sem esta ordem, uma campanha concluída ficaria "esperando o horário" para sempre
    expect(d({ pending: 0, businessHoursOnly: true, isOpen: false })).toEqual({ action: 'done' });
  });

  it('agendada para depois espera, sem estourar o intervalo máximo', () => {
    const em5min = d({ startAt: NOW + 5 * 60_000 });
    expect(em5min).toMatchObject({ action: 'wait' });
    expect((em5min as { retryInMs: number }).retryInMs).toBe(5 * 60_000);

    const amanha = d({ startAt: NOW + 20 * 60 * 60_000 });
    expect((amanha as { retryInMs: number }).retryInMs).toBe(IDLE_RETRY_MS);
  });

  it('startAt no passado não atrapalha', () => {
    expect(d({ startAt: NOW - 60_000 })).toMatchObject({ action: 'send' });
  });

  it('fora do horário comercial espera, quando o cliente pediu essa trava', () => {
    expect(d({ businessHoursOnly: true, isOpen: false })).toMatchObject({ action: 'wait', reason: 'Fora do horário de funcionamento' });
    expect(d({ businessHoursOnly: false, isOpen: false })).toMatchObject({ action: 'send' });
  });

  it('teto diário atingido espera o dia virar, não falha a campanha', () => {
    // falhar aqui marcaria centenas de alvos como erro por uma condição temporária
    expect(d({ dailyRemaining: 0 })).toMatchObject({ action: 'wait', reason: 'Teto diário do número atingido' });
  });

  it('ordem das travas: pausa vence tudo', () => {
    expect(d({ status: 'paused', pending: 0 })).toMatchObject({ action: 'stop' });
  });
});

describe('afterBatch', () => {
  it('reagenda enquanto sobrar fila', () => {
    expect(afterBatch(10)).toMatchObject({ action: 'wait', retryInMs: BATCH_INTERVAL_MS });
    expect(afterBatch(0)).toEqual({ action: 'done' });
  });
});

describe('eligible', () => {
  const t = (over: Partial<Parameters<typeof eligible>[0]> = {}) =>
    eligible({ provider: 'evolution', hasTemplate: false, optedOut: false, now: NOW, ...over });

  it('descadastro bloqueia em qualquer provider', () => {
    expect(t({ optedOut: true })).toMatchObject({ ok: false });
    expect(t({ optedOut: true, provider: 'meta', hasTemplate: true })).toMatchObject({ ok: false });
  });

  it('no QR não há janela de 24h', () => {
    expect(t({ lastInboundAt: null })).toEqual({ ok: true });
  });

  it('na Meta, fora da janela só com template', () => {
    expect(t({ provider: 'meta', lastInboundAt: null })).toMatchObject({ ok: false });
    expect(t({ provider: 'meta', lastInboundAt: NOW - 25 * 60 * 60_000 })).toMatchObject({ ok: false });
    expect(t({ provider: 'meta', lastInboundAt: NOW - 23 * 60 * 60_000 })).toEqual({ ok: true });
    expect(t({ provider: 'meta', lastInboundAt: null, hasTemplate: true })).toEqual({ ok: true });
  });
});

describe('isOptOut', () => {
  it.each(['sair', 'PARAR', '  Cancelar  ', 'descadastrar', 'stop', 'Remover', 'sair.', 'PARAR!'])('reconhece "%s"', (txt) => {
    expect(isOptOut(txt)).toBe(true);
  });

  it.each([
    'quero sair daqui',
    'não quero parar',
    'vou cancelar meu pedido',
    'stopping',
    '',
    null,
    undefined,
  ])('não marca por engano: %s', (txt) => {
    // roda em toda mensagem recebida: marcar errado faz o cliente parar de receber sem pedir
    expect(isOptOut(txt)).toBe(false);
  });
});
