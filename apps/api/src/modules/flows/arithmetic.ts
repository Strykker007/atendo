import { toNumber } from './conditions';

/** Gramática fechada: valores externos são números, nunca fragmentos de expressão. */
export function evaluateArithmetic(source: string, resolve: (key: string) => string): number {
  if (!source.trim() || source.length > 1000) throw new Error('Expressão vazia ou muito longa (máximo 1.000 caracteres).');
  const tokens: (number | string)[] = [];
  let offset = 0;
  while (offset < source.length) {
    const rest = source.slice(offset);
    const match = /^(\s+|\{\{\s*[a-zA-Z_][\w.]*\s*\}\}|(?:\d+(?:\.\d+)?|\.\d+)|[+\-*/()])/.exec(rest);
    if (!match) throw new Error('Símbolo desconhecido na expressão.');
    const token = match[0]; offset += token.length;
    if (!token.trim()) continue;
    if (token.startsWith('{{')) {
      const n = toNumber(resolve(token.slice(2, -2).trim()));
      if (!Number.isFinite(n)) throw new Error('Variável da expressão não é um número.');
      tokens.push(n);
    } else tokens.push(/^[\d.]/.test(token) ? Number(token) : token);
  }
  let cursor = 0;
  function primary(depth: number): number {
    if (depth > 32) throw new Error('Expressão com muitos níveis.');
    const token = tokens[cursor++];
    if (typeof token === 'number') return token;
    if (token === '+' || token === '-') return (token === '-' ? -1 : 1) * primary(depth + 1);
    if (token === '(') {
      const value = sum(depth + 1);
      if (tokens[cursor++] !== ')') throw new Error('Parênteses desequilibrados.');
      return value;
    }
    throw new Error('Falta um número na expressão.');
  }
  function product(depth: number): number {
    let value = primary(depth);
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const op = tokens[cursor++]; const right = primary(depth);
      if (op === '/' && right === 0) throw new Error('Divisão por zero.');
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }
  function sum(depth: number): number {
    let value = product(depth);
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const op = tokens[cursor++]; const right = product(depth);
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }
  const value = sum(0);
  if (cursor !== tokens.length || !Number.isFinite(value)) throw new Error('Expressão inválida ou resultado fora do limite.');
  return value;
}
