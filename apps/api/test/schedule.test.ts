import { describe, expect, it } from 'vitest';
import {
  CLOSED_BAND_ID,
  addOpenMinutesLocal,
  bandIdAt,
  describeNextOpen,
  nextOpenLocal,
  renameBandInDefinition,
  renamedBands,
  resolveSchedule,
  validateSchedule,
  type FlowDefinition,
  type ScheduleBand,
  type ScheduleConfig,
  type ScheduleInterval,
} from '@atendo/shared';
import { addOpenMinutes, scheduleAt, type ScheduleSource } from '../src/modules/tenants/schedule-clock';
import { planInbound } from '../src/modules/flows/hours-gate';

const band = (id: string, name: string, over: Partial<ScheduleBand> = {}): ScheduleBand => ({ id, name, open: true, behavior: 'normal', reply: 'message', items: [], ...over });
let seq = 0;
const iv = (start: string, end: string, bandId = 'open'): ScheduleInterval => ({ id: `i${++seq}`, start, end, bandId });
const m = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
const at = (ymd: string, hm: string) => ({ ymd, minute: m(hm) });

/** Farmácia do exemplo da tarefa: seg–sex 08–12 e 14–21:44 Aberto, 21:45–21:59 Entrega encerrada. */
const farmacia = (): ScheduleConfig => {
  const dia = [iv('08:00', '12:00'), iv('14:00', '21:45'), iv('21:45', '22:00', 'late')];
  return {
    bands: [band('open', 'Aberto'), band('late', 'Entrega encerrada', { behavior: 'notify_continue', items: [{ id: 'x', kind: 'text', text: 'Entregas encerradas por hoje' }] })],
    closed: { behavior: 'notify_stop', reply: 'message', items: [{ id: 'c', kind: 'text', text: 'Fechado' }] },
    week: [[], dia, dia, dia, dia, dia, []],
    exceptions: [],
  };
};
// 2026-10-05 é segunda-feira; 2026-10-12 também (feriado no teste)

describe('Quadro de horários — vários intervalos no mesmo dia', () => {
  const cfg = farmacia();
  it('cada intervalo devolve a sua faixa; fora deles, Fechado', () => {
    expect(bandIdAt(cfg, at('2026-10-05', '07:59'))).toBe(CLOSED_BAND_ID);
    expect(bandIdAt(cfg, at('2026-10-05', '08:00'))).toBe('open');
    expect(bandIdAt(cfg, at('2026-10-05', '12:30'))).toBe(CLOSED_BAND_ID); // almoço
    expect(bandIdAt(cfg, at('2026-10-05', '21:44'))).toBe('open');
    expect(bandIdAt(cfg, at('2026-10-05', '21:45'))).toBe('late');
    expect(bandIdAt(cfg, at('2026-10-05', '21:59'))).toBe('late');
    expect(bandIdAt(cfg, at('2026-10-05', '22:00'))).toBe(CLOSED_BAND_ID);
  });
  it('dia sem intervalo (domingo) é Fechado o dia todo', () => {
    expect(bandIdAt(cfg, at('2026-10-04', '10:00'))).toBe(CLOSED_BAND_ID);
  });
});

describe('Quadro de horários — virada da meia-noite', () => {
  const cfg: ScheduleConfig = { ...farmacia(), week: [[], [iv('18:00', '02:00')], [], [], [], [iv('22:00', '00:00')], [iv('00:00', '00:00')]] };
  it('18:00–02:00 de segunda vale até 02:00 de terça', () => {
    expect(bandIdAt(cfg, at('2026-10-05', '23:30'))).toBe('open');
    expect(bandIdAt(cfg, at('2026-10-06', '01:59'))).toBe('open');
    expect(bandIdAt(cfg, at('2026-10-06', '02:00'))).toBe(CLOSED_BAND_ID);
    // a madrugada da própria segunda NÃO é coberta (diferente do modelo antigo)
    expect(bandIdAt(cfg, at('2026-10-05', '01:00'))).toBe(CLOSED_BAND_ID);
  });
  it('22:00–00:00 vai até a meia-noite; 00:00–00:00 é o dia inteiro', () => {
    expect(bandIdAt(cfg, at('2026-10-09', '23:59'))).toBe('open');
    expect(bandIdAt(cfg, at('2026-10-10', '00:00'))).toBe('open'); // sábado 24h
    expect(bandIdAt(cfg, at('2026-10-10', '23:59'))).toBe('open');
    expect(bandIdAt(cfg, at('2026-10-11', '00:00'))).toBe(CLOSED_BAND_ID); // domingo
  });
  it('período que atravessa a meia-noite é um só', () => {
    const a = resolveSchedule(cfg, at('2026-10-05', '23:00'));
    const b = resolveSchedule(cfg, at('2026-10-06', '01:00'));
    expect(a.periodKey).toBe(b.periodKey);
    expect(a.periodKey).toBe('open@2026-10-05T18:00');
  });
});

describe('Quadro de horários — exceções por data', () => {
  const cfg: ScheduleConfig = {
    ...farmacia(),
    exceptions: [
      { id: 'e1', date: '2026-10-12', label: 'Feriado', closed: true, intervals: [] },
      { id: 'e2', date: '2026-10-13', closed: false, intervals: [iv('10:00', '14:00')] },
    ],
  };
  it('dia fechado ignora a grade da semana', () => {
    expect(bandIdAt(cfg, at('2026-10-12', '09:00'))).toBe(CLOSED_BAND_ID);
  });
  it('dia com intervalos próprios substitui a grade', () => {
    expect(bandIdAt(cfg, at('2026-10-13', '09:00'))).toBe(CLOSED_BAND_ID);
    expect(bandIdAt(cfg, at('2026-10-13', '13:00'))).toBe('open');
    expect(bandIdAt(cfg, at('2026-10-13', '15:00'))).toBe(CLOSED_BAND_ID);
  });
  it('Fechado de sexta 22h até a terça (feriado na segunda) é um período só', () => {
    const sex = resolveSchedule(cfg, at('2026-10-09', '23:00'));
    const seg = resolveSchedule(cfg, at('2026-10-12', '15:00'));
    expect(sex.periodKey).toBe(seg.periodKey);
    expect(seg.periodKey).toBe(`${CLOSED_BAND_ID}@2026-10-09T22:00`);
  });
});

describe('Quadro de horários — envio único por período', () => {
  const cfg = farmacia();
  it('mensagens no mesmo período têm a mesma chave; outro período, outra chave', () => {
    const k1 = resolveSchedule(cfg, at('2026-10-05', '22:10')).periodKey;
    const k2 = resolveSchedule(cfg, at('2026-10-06', '07:50')).periodKey; // mesma noite
    const k3 = resolveSchedule(cfg, at('2026-10-06', '12:10')).periodKey; // almoço: outro Fechado
    const k4 = resolveSchedule(cfg, at('2026-10-06', '22:10')).periodKey; // noite seguinte
    expect(k1).toBe(k2);
    expect(new Set([k1, k3, k4]).size).toBe(3);
  });
  it('faixa especial: cada noite é um período novo', () => {
    expect(resolveSchedule(cfg, at('2026-10-05', '21:50')).periodKey).toBe('late@2026-10-05T21:45');
    expect(resolveSchedule(cfg, at('2026-10-06', '21:50')).periodKey).toBe('late@2026-10-06T21:45');
  });
  it('intervalos colados na mesma faixa formam um período só', () => {
    const c: ScheduleConfig = { ...cfg, week: [[], [iv('08:00', '12:00'), iv('12:00', '18:00')], [], [], [], [], []] };
    expect(resolveSchedule(c, at('2026-10-05', '15:00')).periodKey).toBe('open@2026-10-05T08:00');
  });
  it('atendimento desligado é Fechado, com período próprio por desligamento', () => {
    const s = resolveSchedule(cfg, at('2026-10-05', '10:00'), { attendanceActive: false, inactiveSince: '2026-10-05T09:00:00.000Z' });
    expect(s.band.id).toBe(CLOSED_BAND_ID);
    expect(s.open).toBe(false);
    expect(s.periodKey).toBe('closed@off:2026-10-05T09:00:00.000Z');
  });
  it('quadro sem nenhum intervalo: Fechado sempre, chave estável', () => {
    const c: ScheduleConfig = { ...cfg, week: [[], [], [], [], [], [], []] };
    expect(resolveSchedule(c, at('2026-10-05', '10:00')).periodKey).toBe(resolveSchedule(c, at('2026-10-06', '10:00')).periodKey);
  });
});

describe('Quadro de horários — fuso', () => {
  const src = (timezone: string): ScheduleSource => ({ timezone, config: farmacia(), attendanceActive: true });
  it('usa o fuso do quadro, não o da máquina', () => {
    const d = new Date('2026-10-05T11:30:00Z'); // 08:30 SP, 07:30 Manaus
    expect(scheduleAt(src('America/Sao_Paulo'), d).band.id).toBe('open');
    expect(scheduleAt(src('America/Manaus'), d).band.id).toBe(CLOSED_BAND_ID);
  });
  it('próxima abertura e texto da variável', () => {
    const s = scheduleAt(src('America/Sao_Paulo'), new Date('2026-10-06T01:30:00Z')); // seg 22:30
    expect(s.nextOpen?.toISOString()).toBe('2026-10-06T11:00:00.000Z');
    expect(s.nextOpenLabel).toBe('amanhã às 08:00');
  });
});

describe('Quadro de horários — próxima abertura e tempo só no horário', () => {
  const cfg = farmacia();
  it('faixa marcada como "não conta como atendimento" é pulada', () => {
    const c: ScheduleConfig = { ...cfg, bands: cfg.bands.map((b) => (b.id === 'late' ? { ...b, open: false } : b)) };
    expect(nextOpenLocal(c, at('2026-10-05', '21:50'))).toEqual(at('2026-10-06', '08:00'));
    expect(nextOpenLocal(cfg, at('2026-10-05', '21:50'))).toEqual(at('2026-10-05', '21:50'));
  });
  it('soma só o tempo aberto (pula almoço e noite)', () => {
    // 11:30 + 60 min: 30 até 12:00, almoço, 30 a partir das 14:00
    expect(addOpenMinutesLocal(cfg, at('2026-10-05', '11:30'), 60)).toEqual(at('2026-10-05', '14:30'));
    // sexta 21:30 + 60: 30 min até 22:00, fim de semana, 30 min na segunda
    expect(addOpenMinutesLocal(cfg, at('2026-10-09', '21:30'), 60)).toEqual(at('2026-10-12', '08:30'));
  });
  it('em instante real, no fuso do quadro', () => {
    const src: ScheduleSource = { timezone: 'America/Sao_Paulo', config: cfg, attendanceActive: true };
    expect(addOpenMinutes(src, new Date('2026-10-05T14:30:00Z'), 60).toISOString()).toBe('2026-10-05T17:30:00.000Z');
  });
  it('atendimento desligado conta tempo corrido', () => {
    const src: ScheduleSource = { timezone: 'America/Sao_Paulo', config: cfg, attendanceActive: false };
    expect(addOpenMinutes(src, new Date('2026-10-05T14:30:00Z'), 60).toISOString()).toBe('2026-10-05T15:30:00.000Z');
  });
  it('texto relativo da próxima abertura', () => {
    expect(describeNextOpen(at('2026-10-05', '12:30'), at('2026-10-05', '14:00'))).toBe('hoje às 14:00');
    expect(describeNextOpen(at('2026-10-09', '22:30'), at('2026-10-12', '08:00'))).toBe('segunda-feira às 08:00');
  });
});

describe('Quadro de horários — validação', () => {
  it('aceita o exemplo da farmácia', () => {
    expect(validateSchedule(farmacia())).toEqual([]);
  });
  it('recusa sobreposição no mesmo dia, com mensagem clara', () => {
    const c: ScheduleConfig = { ...farmacia(), week: [[], [iv('08:00', '12:00'), iv('11:00', '13:00')], [], [], [], [], []] };
    const issues = validateSchedule(c);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({ path: 'week.1', message: 'Segunda-feira: 08:00–12:00 e 11:00–13:00 se sobrepõem.' });
  });
  it('recusa sobreposição com o que vem da noite anterior', () => {
    const c: ScheduleConfig = { ...farmacia(), week: [[iv('22:00', '03:00')], [iv('02:00', '06:00')], [], [], [], [], []] };
    expect(validateSchedule(c)[0]?.path).toBe('week.1');
  });
  it('intervalos encostados não se sobrepõem', () => {
    const c: ScheduleConfig = { ...farmacia(), week: [[], [iv('08:00', '12:00'), iv('12:00', '13:00')], [], [], [], [], []] };
    expect(validateSchedule(c)).toEqual([]);
  });
  it('faixa sem nome, repetida ou chamada "Fechado"; intervalo sem faixa; fluxo não escolhido', () => {
    const c: ScheduleConfig = {
      ...farmacia(),
      bands: [band('a', 'Aberto'), band('b', 'aberto'), band('c', 'Fechado'), band('d', '', { behavior: 'notify_stop', reply: 'flow' })],
      week: [[], [iv('08:00', '09:00', 'zzz')], [], [], [], [], []],
    };
    const msgs = validateSchedule(c).map((i) => i.message).join(' | ');
    expect(msgs).toContain('repetida');
    expect(msgs).toContain('"Fechado" é a faixa fixa');
    expect(msgs).toContain('Toda faixa precisa de nome');
    expect(msgs).toContain('escolha o fluxo');
    expect(msgs).toContain('sem faixa');
  });
  it('exceção com data inválida ou repetida', () => {
    const c: ScheduleConfig = { ...farmacia(), exceptions: [{ id: 'a', date: '2026-02-30', closed: true, intervals: [] }, { id: 'b', date: '2026-12-25', closed: true, intervals: [] }, { id: 'c', date: '2026-12-25', closed: true, intervals: [] }] };
    const msgs = validateSchedule(c).map((i) => i.message);
    expect(msgs).toContain('Exceção com data inválida.');
    expect(msgs).toContain('25/12/2026: data repetida nas exceções.');
  });
});

describe('Comportamento da faixa na mensagem recebida', () => {
  const base = { reply: 'message' as const, paused: false, newAttendance: true, activeRun: false };
  it('seguir normal: boas-vindas em atendimento novo, sem resposta da faixa', () => {
    expect(planInbound({ ...base, behavior: 'normal' })).toEqual({ welcome: true, notifyFirst: false, proceed: true, notifyIfUnhandled: false });
  });
  it('enviar e parar: só a resposta da faixa, sem boas-vindas', () => {
    expect(planInbound({ ...base, behavior: 'notify_stop' })).toEqual({ welcome: false, notifyFirst: true, proceed: false, notifyIfUnhandled: false });
  });
  it('enviar e seguir: boas-vindas, resposta e atendimento normal', () => {
    expect(planInbound({ ...base, behavior: 'notify_continue' })).toEqual({ welcome: true, notifyFirst: true, proceed: true, notifyIfUnhandled: false });
  });
  it('enviar e seguir com fluxo não interrompe quem já está noutro fluxo', () => {
    expect(planInbound({ ...base, behavior: 'notify_continue', reply: 'flow', activeRun: true }).notifyFirst).toBe(false);
  });
  it('só se nenhum fluxo responder (modelo antigo do aviso)', () => {
    expect(planInbound({ ...base, behavior: 'notify_fallback' })).toEqual({ welcome: true, notifyFirst: false, proceed: true, notifyIfUnhandled: true });
  });
  it('robô pausado: só a mensagem da faixa sai; fluxo da faixa, boas-vindas e atendimento não', () => {
    expect(planInbound({ ...base, paused: true, behavior: 'notify_fallback' })).toEqual({ welcome: false, notifyFirst: true, proceed: false, notifyIfUnhandled: false });
    expect(planInbound({ ...base, paused: true, behavior: 'notify_stop', reply: 'flow' }).notifyFirst).toBe(false);
    expect(planInbound({ ...base, paused: true, behavior: 'normal' }).notifyFirst).toBe(false);
  });
  it('conversa em andamento não recebe boas-vindas', () => {
    expect(planInbound({ ...base, newAttendance: false, behavior: 'normal' }).welcome).toBe(false);
  });
});

describe('Faixa renomeada → condições dos fluxos', () => {
  const def = {
    nodes: [
      { id: 'c1', type: 'condition', position: { x: 0, y: 0 }, data: { branches: [{ id: 'b1', label: 'x', match: 'all', rules: [{ id: 'r1', operand: 'schedule_band', op: 'is_true', band: 'Entrega Encerrada' }, { id: 'r2', operand: 'schedule_band', op: 'is_true', band: 'closed' }] }] } },
      { id: 'c2', type: 'condition', position: { x: 0, y: 0 }, data: { kind: 'business_hours' } },
      { id: 'm', type: 'message', position: { x: 0, y: 0 }, data: { items: [] } },
    ],
    edges: [],
  } as unknown as FlowDefinition;
  it('detecta a faixa renomeada pelo id', () => {
    const before = farmacia();
    const after: ScheduleConfig = { ...before, bands: before.bands.map((b) => (b.id === 'late' ? { ...b, name: 'Só balcão' } : b)) };
    expect(renamedBands(before, after)).toEqual([{ from: 'Entrega encerrada', to: 'Só balcão' }]);
    // só mudar maiúscula não é renomear (a Condição não diferencia)
    expect(renamedBands(before, { ...before, bands: before.bands.map((b) => ({ ...b, name: b.name.toUpperCase() })) })).toEqual([]);
  });
  it('troca o nome nas regras (sem diferenciar maiúsculas/acentos) e conta', () => {
    const { def: out, count } = renameBandInDefinition(def, 'entrega encerrada', 'Só balcão');
    expect(count).toBe(1);
    const rules = (out.nodes[0] as unknown as { data: { branches: { rules: { band: string }[] }[] } }).data.branches[0].rules;
    expect(rules.map((r) => r.band)).toEqual(['Só balcão', 'closed']);
    expect(out.nodes[1]).toBe(def.nodes[1]); // formato antigo e outros blocos intactos
  });
  it('nada para trocar devolve a mesma definição', () => {
    expect(renameBandInDefinition(def, 'Almoço', 'X')).toEqual({ def, count: 0 });
  });
});
