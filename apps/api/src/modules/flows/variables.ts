import type { VariableAssignment } from '@atendo/shared';
import { interpolate, type InterpolateCtx } from './answer';
import { toNumber } from './conditions';

/**
 * Operações do Manipulador. Pura: recebe as variáveis atuais e devolve as novas, sem tocar
 * no original. Executa em ordem — a segunda operação já enxerga o resultado da primeira.
 * `problems`: operações que não puderam ser feitas (ex.: somar texto), em português, para
 * o motor avisar a equipe — nunca falham em silêncio.
 */
export function applyAssignments(
  vars: Record<string, string>,
  assignments: VariableAssignment[],
  env: { contact: InterpolateCtx['contact']; globals?: InterpolateCtx['globals']; now: Date; timezone: string },
): { vars: Record<string, string>; problems: string[] } {
  const next = { ...vars };
  const problems: string[] = [];
  for (const a of assignments) {
    if (!a.varName) continue;
    const value = () => interpolate(a.value ?? '', { contact: env.contact, globals: env.globals, vars: next });
    switch (a.op ?? 'set') {
      case 'set':
        next[a.varName] = value();
        break;
      case 'add':
      case 'subtract': {
        // variável vazia conta como 0; valor que não é número não mexe na variável
        const cur = (next[a.varName] ?? '').trim() === '' ? 0 : toNumber(next[a.varName]);
        const delta = toNumber(value());
        if (Number.isNaN(cur) || Number.isNaN(delta)) {
          const verb = a.op === 'add' ? 'somar' : 'subtrair';
          problems.push(Number.isNaN(delta)
            ? `não deu para ${verb} "${value()}" em {{${a.varName}}}: não é um número. A variável ficou como estava ("${next[a.varName] ?? ''}").`
            : `não deu para ${verb} em {{${a.varName}}}: o valor atual ("${next[a.varName]}") não é um número. A variável ficou como estava.`);
          break;
        }
        next[a.varName] = formatNumber(a.op === 'add' ? cur + delta : cur - delta);
        break;
      }
      case 'append':
        next[a.varName] = (next[a.varName] ?? '') + value();
        break;
      case 'clear':
        next[a.varName] = '';
        break;
      case 'copy':
        // mesma resolução do texto: aceita também contact.<campo>
        next[a.varName] = a.from ? interpolate(`{{${a.from}}}`, { contact: env.contact, globals: env.globals, vars: next }) : '';
        break;
      case 'now':
        next[a.varName] = formatNow(env.now, env.timezone, a.format ?? 'datetime');
        break;
    }
  }
  return { vars: next, problems };
}

/** Sem lixo de ponto flutuante (0.1 + 0.2 = "0.3"); decimal com ponto. */
export function formatNumber(n: number) {
  return String(Math.round(n * 1e6) / 1e6);
}

/** dd/mm/aaaa hh:mm (ou só data / só hora) no fuso do cliente. */
export function formatNow(date: Date, timezone: string, format: 'datetime' | 'date' | 'time') {
  const opts: Intl.DateTimeFormatOptions =
    format === 'date' ? { day: '2-digit', month: '2-digit', year: 'numeric' }
      : format === 'time' ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
        : { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  return new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, ...opts }).format(date).replace(',', '');
}
