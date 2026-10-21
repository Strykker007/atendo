import { describe, expect, it } from 'vitest';
import { planoDaRecuperacao, type ConversaAtual } from '../src/modules/conversations/gap-recovery-plan';

const t = (hhmm: string) => new Date(`2026-10-21T${hhmm}:00Z`);
const rec = (hhmm: string, text = 'quero um remédio') => ({ fromMe: false, timestamp: t(hhmm), type: 'text', text });
const env = (hhmm: string, text = 'temos sim') => ({ fromMe: true, timestamp: t(hhmm), type: 'text', text });
const conv = (over: Partial<ConversaAtual> = {}): ConversaAtual => ({
  status: 'in_progress', closedAt: null, lastMessageAt: t('16:00'), lastInboundAt: t('16:00'), awaitingSince: null, ...over,
});

describe('planoDaRecuperacao', () => {
  it('cliente sem resposta no fim: não lidas, espera e volta para a fila se estava encerrada', () => {
    const p = planoDaRecuperacao(conv({ status: 'closed', closedAt: t('12:00') }), false, [rec('16:10'), rec('16:12')]);
    expect(p).toEqual({ status: 'waiting', ultima: 1, lastInboundAt: t('16:12'), unreadIncrement: 2, awaitingSince: t('16:10') });
  });

  it('conversa em andamento: não muda o status e mantém a espera que já corria', () => {
    const p = planoDaRecuperacao(conv({ awaitingSince: t('15:50') }), false, [rec('16:10')]);
    expect(p.status).toBeUndefined();
    expect(p.awaitingSince).toEqual(t('15:50'));
    expect(p.unreadIncrement).toBe(1);
  });

  it('respondida pelo celular no meio do lote: só conta o que ficou depois da resposta', () => {
    const p = planoDaRecuperacao(conv({ awaitingSince: t('15:50') }), false, [rec('16:10'), env('16:15'), rec('16:20')]);
    expect(p.unreadIncrement).toBe(1);
    expect(p.awaitingSince).toEqual(t('16:20'));
    expect(p.ultima).toBe(2);
  });

  it('a última é nossa (celular): a espera acaba e não soma não lida', () => {
    const p = planoDaRecuperacao(conv({ awaitingSince: t('15:50') }), false, [rec('16:10'), env('16:15')]);
    expect(p).toEqual({ ultima: 1, lastInboundAt: t('16:10'), unreadIncrement: 0, awaitingSince: null });
  });

  it('encerrada e a última é nossa depois da carência: volta como em atendimento (igual ao celular ao vivo)', () => {
    const p = planoDaRecuperacao(conv({ status: 'closed', closedAt: t('10:00') }), false, [env('16:15')]);
    expect(p.status).toBe('in_progress');
  });

  it('mais antigas que a conversa: entram no histórico e a conversa não volta no tempo', () => {
    const p = planoDaRecuperacao(conv({ status: 'closed', closedAt: t('16:30'), lastMessageAt: t('16:30'), lastInboundAt: t('16:25') }), false, [rec('16:10'), rec('16:12')]);
    expect(p).toEqual({ unreadIncrement: 0 });
  });

  it('só as mais novas que a conversa contam; as antigas do mesmo lote não', () => {
    const p = planoDaRecuperacao(conv({ lastMessageAt: t('16:11') }), false, [rec('16:10'), rec('16:12')]);
    expect(p.unreadIncrement).toBe(1);
    expect(p.awaitingSince).toEqual(t('16:12'));
  });

  it('"obrigada" logo depois de encerrar (carência) não reabre', () => {
    const p = planoDaRecuperacao(conv({ status: 'closed', closedAt: t('16:00') }), false, [rec('16:05', 'obrigada!')]);
    expect(p.status).toBeUndefined();
    expect(p.unreadIncrement).toBe(1);
  });

  it('pergunta na carência reabre', () => {
    const p = planoDaRecuperacao(conv({ status: 'closed', closedAt: t('16:00') }), false, [rec('16:05', 'e a entrega?')]);
    expect(p.status).toBe('waiting');
  });

  it('pessoa nova: conversa nasce na fila (recebida) ou em atendimento (só enviada)', () => {
    expect(planoDaRecuperacao(null, false, [rec('16:10')]).status).toBe('waiting');
    expect(planoDaRecuperacao(null, false, [env('16:10')]).status).toBe('in_progress');
  });

  it('chat livre (isento/grupo): nunca fila nem espera', () => {
    const p = planoDaRecuperacao(conv({ status: 'closed', closedAt: t('12:00') }), true, [rec('16:10')]);
    expect(p.status).toBe('in_progress');
    expect(p.awaitingSince).toBeUndefined();
    expect(p.unreadIncrement).toBe(1);
  });
});
