/**
 * Corta em `max` unidades sem partir um emoji (par surrogate) no meio. `slice` puro deixa meio
 * emoji solto, e o Postgres/Prisma recusa a string ("unexpected end of hex escape") — foi o 500
 * no envio de mensagem com emoji perto do caractere 120 da prévia (10/11/2026).
 */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const code = s.charCodeAt(max - 1);
  // último caractere mantido é a 1ª metade de um par: corta antes dele
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}
