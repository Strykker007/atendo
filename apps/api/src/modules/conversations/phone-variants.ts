/**
 * Formas do mesmo celular brasileiro, com e sem o nono dígito.
 *
 * O WhatsApp ainda identifica muitos números antigos SEM o 9 (5562 9999-8888 vira
 * 556299998888), e é assim que o contato nasce quando ele escreve primeiro. Quem inicia a
 * conversa pelo painel digita COM o 9 — sem esta checagem, nasceria um segundo contato da
 * mesma pessoa e o histórico ficaria partido. Fora do Brasil (ou fixo), só o próprio número.
 */
export function phoneVariants(digits: string): string[] {
  const d = digits.replace(/\D/g, '');
  const m = /^55(\d{2})(\d{8,9})$/.exec(d);
  if (!m) return [d];
  const [, ddd, local] = m;
  // celular: começa com 9 (com o dígito) ou com 6–9 (sem ele). Fixo (2–5) não tem variante.
  if (local.length === 9 && local.startsWith('9')) return [d, `55${ddd}${local.slice(1)}`];
  if (local.length === 8 && /^[6-9]/.test(local)) return [d, `55${ddd}9${local}`];
  return [d];
}
