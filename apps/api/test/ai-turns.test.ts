import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_TURNS, afterAiAnswer } from '../src/modules/flows/ai-turns';

describe('afterAiAnswer — quando a IA para de conversar', () => {
  it('sem "continuar conversando", responde uma vez e sai', () => {
    expect(afterAiAnswer(1, {})).toBe('done');
    expect(afterAiAnswer(1, { keepTalking: false, maxTurns: 99 })).toBe('done');
  });

  it('conversando, segue esperando a próxima mensagem', () => {
    expect(afterAiAnswer(1, { keepTalking: true, maxTurns: 8 })).toBe('wait');
    expect(afterAiAnswer(7, { keepTalking: true, maxTurns: 8 })).toBe('wait');
  });

  it('ao atingir o limite, sai — é o freio de custo', () => {
    expect(afterAiAnswer(8, { keepTalking: true, maxTurns: 8 })).toBe('done');
    expect(afterAiAnswer(9, { keepTalking: true, maxTurns: 8 })).toBe('done');
  });

  it('sem limite configurado usa o padrão', () => {
    expect(afterAiAnswer(DEFAULT_MAX_TURNS - 1, { keepTalking: true })).toBe('wait');
    expect(afterAiAnswer(DEFAULT_MAX_TURNS, { keepTalking: true })).toBe('done');
  });

  it('limite zerado ou negativo não vira conversa infinita', () => {
    for (const maxTurns of [0, -5]) {
      expect(afterAiAnswer(1, { keepTalking: true, maxTurns })).toBe('done');
    }
  });
});
