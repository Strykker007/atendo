import { applyVariableFilters, firstName, lastName, parseVariableExpr } from '@atendo/shared';

/**
 * Interpretação da resposta do contato. Isolado (sem Nest/Prisma) porque é o ponto
 * em que o fluxo decide o caminho — e onde um erro manda o cliente para a opção errada.
 */

/** Sem acentos, minúsculas e espaços colapsados: "Promoção " e "promocao" comparam iguais. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Resolve a escolha do contato: id do botão, número da opção ("2", "2.", "2)") ou o texto da
 * opção — sem diferenciar maiúsculas e acentos; por último, texto parecido (contido, 3+ letras).
 */
export function choose<T extends { id: string; title: string }>(options: T[], answer: string, replyId?: string): T | undefined {
  if (replyId) {
    const byId = options.find((o) => o.id === replyId);
    if (byId) return byId;
  }
  const a = fold(answer);
  const num = a.match(/^(\d+)\s*[.)-]?$/);
  if (num && options[Number(num[1]) - 1]) return options[Number(num[1]) - 1];
  return options.find((o) => fold(o.title) === a) ?? options.find((o) => a.length >= 3 && fold(o.title).includes(a));
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

export interface InterpolateCtx {
  contact: {
    name: string | null; phone: string; email?: string | null; address?: string | null; note1?: string | null; note2?: string | null;
    /** campos livres da ficha, pela chave de `attributeVarKey` ("placa_do_carro") */
    attributes?: Record<string, string>;
  };
  vars: Record<string, string>;
  /** empresa, saudação, atendente… (`InterpolationService`). A variável do fluxo vence em nome igual. */
  globals?: Record<string, string>;
}

const CONTACT_KEYS = ['name', 'phone', 'email', 'address', 'note1', 'note2'] as const;

/**
 * `{{nome_da_variavel}}` (variável do fluxo), `{{contact.<campo>}}` — name, first_name,
 * last_name, phone, email, address, note1, note2 ou a chave de um campo livre da ficha — e as
 * globais (`{{empresa}}`, `{{saudacao}}`…). Aceita filtros e valor padrão
 * (`{{contact.name | first | upper}}`, `{{contact.first_name || 'Cliente'}}`, docs/variaveis.md).
 * Chave desconhecida (sem valor padrão) vira texto vazio; com `keepUnknown` (mensagem digitada
 * no chat) fica como estava. Sintaxe inválida dentro de `{{ }}` sempre fica como estava.
 * `escape` trata cada valor antes de entrar no texto (ex.: corpo JSON do webhook, onde uma
 * aspa no nome quebraria o JSON).
 */
export function interpolate(text: string, ctx: InterpolateCtx, escape: (v: string) => string = (v) => v, opts?: { keepUnknown?: boolean }) {
  return text.replace(/\{\{([^{}]*)\}\}/g, (raw, inner: string) => {
    const expr = parseVariableExpr(inner);
    if (!expr) return raw;
    const value = applyVariableFilters(resolveVar(expr.key, ctx), expr.filters);
    if (value === undefined) return opts?.keepUnknown ? raw : '';
    return escape(value);
  });
}

function resolveVar(key: string, ctx: InterpolateCtx): string | undefined {
  if (key.startsWith('contact.')) {
    const field = key.slice(8);
    if (field === 'first_name') return firstName(ctx.contact.name);
    if (field === 'last_name') return lastName(ctx.contact.name);
    if ((CONTACT_KEYS as readonly string[]).includes(field)) return ctx.contact[field as (typeof CONTACT_KEYS)[number]] ?? '';
    // campo livre que este contato não tem: vazio (outro cliente pode ter)
    if (ctx.contact.attributes) return ctx.contact.attributes[field] ?? '';
    return undefined;
  }
  return ctx.vars[key] ?? ctx.globals?.[key];
}

/** Valor dentro de uma string JSON: `"{{nome}}"` continua JSON válido com aspas/quebras no nome. */
export const jsonEscape = (v: string) => JSON.stringify(v).slice(1, -1);
