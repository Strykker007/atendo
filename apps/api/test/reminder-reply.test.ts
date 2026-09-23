import { describe, expect, it } from 'vitest';
import { REMINDER_OPTIONS, reminderChoice } from '../src/modules/scheduling/reminder-reply';

describe('reminderChoice — resposta ao lembrete de agendamento', () => {
  it('toque no botão (Meta oficial)', () => {
    expect(reminderChoice('Confirmar', 'confirm')).toBe('confirm');
    expect(reminderChoice('Remarcar', 'reschedule')).toBe('reschedule');
  });

  it('número da opção (Evolution, lista numerada)', () => {
    expect(reminderChoice('1')).toBe('confirm');
    expect(reminderChoice('2')).toBe('reschedule');
    expect(reminderChoice(' 2 ')).toBe('reschedule');
  });

  it('a palavra exata, sem diferenciar maiúsculas', () => {
    expect(reminderChoice('confirmar')).toBe('confirm');
    expect(reminderChoice('REMARCAR')).toBe('reschedule');
  });

  it('mensagem comum não é confundida com resposta — roda em toda mensagem recebida', () => {
    for (const texto of ['bom dia', 'quero remarcar meu horário', 'confirmo sim', 'mar', 'con', 'ok', '', '3', '0']) {
      expect(reminderChoice(texto), texto).toBeUndefined();
    }
  });

  it('as opções são as que vão para o WhatsApp, na ordem que vira 1 e 2', () => {
    expect(REMINDER_OPTIONS.map((o) => o.id)).toEqual(['confirm', 'reschedule']);
    expect(REMINDER_OPTIONS.every((o) => o.title.length <= 20)).toBe(true); // limite de título de botão da Meta
  });
});
