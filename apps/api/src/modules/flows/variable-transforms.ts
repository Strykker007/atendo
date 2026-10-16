import { jsonValueText, readJsonPath, parseJsonPath, type VariableAssignment } from '@atendo/shared';
import { toNumber } from './conditions';
import { evaluateArithmetic } from './arithmetic';

/** Regex simples sem alternativas, referências, lookaround ou repetição de grupos. */
export function simpleRegex(pattern: string) {
  if (!pattern || pattern.length > 200 || /[{}]|\(\?|\\[1-9]|\||\)[*+?{]/.test(pattern)) throw new Error('Regex não permitida.');
  const repetitions = pattern.replace(/\\./g, '').match(/[*+?{]/g) ?? [];
  if (repetitions.length > 1) throw new Error('Regex simples aceita no máximo uma repetição.');
  return new RegExp(pattern, 'u');
}

function number(value: string) {
  const result = toNumber(value);
  if (!Number.isFinite(result)) throw new Error('Valor não é um número.');
  return result;
}

/** Datas civis não passam pelo fuso do servidor; timestamps são convertidos ao fuso do cliente. */
function calendar(value: string, timezone: string): Date {
  let match: string[] | null = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (br) match = [br[0], br[3], br[2], br[1]];
  if (match) {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('Data inválida.');
    return date;
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('Use data DD/MM/AAAA, AAAA-MM-DD ou ISO com fuso.');
  calendar(value.slice(0, 10), timezone);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Data inválida.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (key: string) => Number(parts.find((p) => p.type === key)?.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
}

export function transformVariable(a: VariableAssignment, value: string, resolve: (key: string) => string, timezone: string): string {
  const parameter = (text?: string) => (text ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => resolve(key));
  const integer = (raw: string, min: number, max: number) => {
    const n = number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error('Parâmetro inteiro fora do limite.');
    return n;
  };
  switch (a.op) {
    case 'upper': return value.toLocaleUpperCase('pt-BR');
    case 'lower': return value.toLocaleLowerCase('pt-BR');
    case 'trim': return value.trim();
    case 'replace': {
      if (!a.pattern) throw new Error('Informe o texto ou regex a substituir.');
      if (!a.regex) return value.split(parameter(a.pattern)).join(parameter(a.replacement));
      const regex = simpleRegex(parameter(a.pattern));
      if (value.length > 2000) throw new Error('Texto para regex excede 2.000 caracteres.');
      return value.replace(new RegExp(regex.source, 'gu'), () => parameter(a.replacement));
    }
    case 'extract': {
      if (value.length > 2000) throw new Error('Texto para regex excede 2.000 caracteres.');
      const match = simpleRegex(parameter(a.pattern)).exec(value);
      return match?.[1] ?? '';
    }
    case 'slice': {
      const start = integer(parameter(a.start ?? '0'), 0, 100000);
      const length = integer(parameter(a.length ?? '1000'), 0, 100000);
      return value.slice(start, start + length);
    }
    case 'to_number': return String(number(value));
    case 'round': return String(Number(number(value).toFixed(integer(parameter(a.decimals ?? '2'), 0, 10))));
    case 'currency': return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(number(value));
    case 'expression': return String(evaluateArithmetic(a.value, resolve));
    case 'json_path': {
      const path = parameter(a.path);
      if (parseJsonPath(path) === null) throw new Error('Caminho JSON inválido.');
      return jsonValueText(readJsonPath(JSON.parse(value), path));
    }
    case 'list_count': {
      const list: unknown = JSON.parse(value);
      if (!Array.isArray(list)) throw new Error('JSON não é uma lista.');
      return String(list.length);
    }
    case 'date_format': {
      const date = calendar(value, timezone);
      return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    }
    case 'date_add': {
      const date = calendar(value, timezone);
      date.setUTCDate(date.getUTCDate() + integer(parameter(a.days ?? '0'), -365000, 365000));
      return date.toISOString().slice(0, 10);
    }
    case 'date_diff': return String((calendar(value, timezone).getTime() - calendar(parameter(a.otherDate), timezone).getTime()) / 86400000);
    default: throw new Error('Operação desconhecida.');
  }
}
