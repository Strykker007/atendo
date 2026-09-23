/**
 * Interpretação da resposta do contato. Isolado (sem Nest/Prisma) porque é o ponto
 * em que o fluxo decide o caminho — e onde um erro manda o cliente para a opção errada.
 */

/** Resolve a escolha do contato: id do botão, número da opção ou texto parecido. */
export function choose<T extends { id: string; title: string }>(options: T[], answer: string, replyId?: string): T | undefined {
  if (replyId) {
    const byId = options.find((o) => o.id === replyId);
    if (byId) return byId;
  }
  const a = answer.trim().toLowerCase();
  const idx = Number(a) - 1;
  if (Number.isInteger(idx) && options[idx]) return options[idx];
  return options.find((o) => o.title.toLowerCase() === a) ?? options.find((o) => a.length >= 3 && o.title.toLowerCase().includes(a));
}

export type Validation = 'none' | 'email' | 'phone' | 'number';

/** Valida a resposta de um nó Perguntar conforme a validação escolhida no editor. */
export function validAnswer(answer: string, validation: Validation) {
  if (!answer) return false;
  if (validation === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer);
  if (validation === 'phone') return answer.replace(/\D/g, '').length >= 10;
  if (validation === 'number') return !Number.isNaN(Number(answer.replace(',', '.')));
  return true;
}

/** {{contact.name}}, {{contact.phone}}, {{nome_da_variavel}} */
export function interpolate(text: string, ctx: { contact: { name: string | null; phone: string }; vars: Record<string, string> }) {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    if (key === 'contact.name') return ctx.contact.name ?? '';
    if (key === 'contact.phone') return ctx.contact.phone;
    return ctx.vars[key] ?? '';
  });
}
