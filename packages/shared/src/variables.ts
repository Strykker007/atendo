/**
 * Variáveis `{{...}}` comuns a fluxos, respostas rápidas, campanhas e mensagens do chat
 * (docs/variaveis.md). Aqui fica só o que front e API precisam calcular igual: a chave de um
 * campo livre da ficha, a saudação pelo horário e o primeiro nome. Quem troca o texto é o
 * `interpolate` da API.
 */

/** Variáveis do sistema que o menu "Inserir variável" oferece. `aliases` valem igual no envio. */
export const SYSTEM_VARIABLES: { key: string; label: string; aliases?: string[] }[] = [
  { key: 'contact.name', label: 'Nome do contato' },
  { key: 'contact.first_name', label: 'Primeiro nome do contato' },
  { key: 'contact.last_name', label: 'Último sobrenome do contato' },
  { key: 'contact.phone', label: 'Telefone do contato (só números)' },
  { key: 'contact.phone | formatted', label: 'Telefone do contato — (62) 99999-9999' },
  { key: 'contact.email', label: 'E-mail do contato (da ficha)' },
  { key: 'contact.address', label: 'Endereço do contato (da ficha)' },
  { key: 'contact.note1', label: 'Observação 1 do contato (da ficha)' },
  { key: 'contact.note2', label: 'Observação 2 do contato (da ficha)' },
  { key: 'empresa', label: 'Nome da empresa', aliases: ['company.name'] },
  { key: 'saudacao', label: 'Bom dia / Boa tarde / Boa noite', aliases: ['greeting'] },
];

/**
 * Atalhos do topo do menu "Inserir variável" (fluxos, respostas rápidas, chat). Um clique e
 * pronto — sem precisar saber a sintaxe.
 */
export const VARIABLE_SHORTCUTS: { key: string; label: string }[] = [
  { key: 'contact.first_name', label: 'Primeiro nome do cliente' },
  { key: 'contact.name', label: 'Nome completo do cliente' },
  { key: 'company.name', label: 'Nome da empresa' },
  { key: 'greeting', label: 'Saudação por horário' },
];

/** Campos fixos da ficha — um campo livre com o mesmo nome não os sobrescreve. */
export const CONTACT_FIXED_KEYS = ['name', 'first_name', 'last_name', 'phone', 'email', 'address', 'note1', 'note2'] as const;

/**
 * Chave de um campo livre da ficha: "Placa do carro" → `placa_do_carro`, "C.P.F." → `c_p_f`.
 * Sem acentos, minúsculas, o que não é letra/número vira `_`. Usada como `{{contact.<chave>}}`.
 */
export function attributeVarKey(label: string) {
  return label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** 05h–11h59 Bom dia · 12h–17h59 Boa tarde · 18h–04h59 Boa noite. */
export function greetingForHour(hour: number) {
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Saudação no fuso do cliente (não do servidor). */
export function greetingAt(date: Date, timezone: string) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(date));
  return greetingForHour(hour);
}

/** "Maria Clara Souza" → "Maria". Vazio continua vazio. */
export function firstName(name: string | null | undefined) {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** "Tiago Lima de Melo" → "Melo". Um nome só é o próprio nome; vazio continua vazio. */
export function lastName(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

/** Partículas que ficam minúsculas no meio do nome ("Tiago Lima de Melo"). */
const NAME_PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'van', 'von']);

/** "TIAGO LIMA DE MELO" → "Tiago Lima de Melo"; "ana-maria" → "Ana-Maria". */
export function titleCase(text: string) {
  let first = true;
  return text.toLocaleLowerCase('pt-BR').replace(/\S+/g, (word) => {
    const keep = !first && NAME_PARTICLES.has(word);
    first = false;
    if (keep) return word;
    return word.split('-').map((p) => p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1)).join('-');
  });
}

/**
 * Telefone legível. Brasil (com ou sem o 55): "(62) 99999-9999" / "(62) 3333-4444". Outro país:
 * "+<dígitos>". Texto que não é telefone (tem letra) volta como veio.
 */
export function formatPhone(raw: string) {
  if (/\p{L}/u.test(raw)) return raw;
  let d = raw.replace(/\D/g, '');
  if (!d) return raw;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  // DDD não começa com 0; celular de 11 dígitos tem o 9 na frente (evita formatar +1 dos EUA como BR)
  if (d[0] !== '0' && d.length === 11 && d[2] === '9') return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d[0] !== '0' && d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `+${d}`;
}

/** Filtros de `{{variavel | filtro}}`. Nome desconhecido é ignorado (o valor passa como está). */
export const VARIABLE_FILTERS: Record<string, { label: string; apply: (v: string) => string }> = {
  first: { label: 'Primeiro nome', apply: firstName },
  last: { label: 'Último sobrenome', apply: lastName },
  title: { label: 'Nome Próprio', apply: titleCase },
  upper: { label: 'MAIÚSCULAS', apply: (v) => v.toLocaleUpperCase('pt-BR') },
  lower: { label: 'minúsculas', apply: (v) => v.toLocaleLowerCase('pt-BR') },
  formatted: { label: 'Telefone (62) 99999-9999', apply: formatPhone },
  trim: { label: 'Sem espaços nas pontas', apply: (v) => v.trim() },
};

export interface VariableFilter { name: string; arg?: string }
export interface VariableExpr { key: string; filters: VariableFilter[] }

// aspas retas e as "curvas" que o celular/Word trocam sozinhos
const QUOTES: Record<string, string> = { "'": "'", '"': '"', '‘': '’', '’': '’', '“': '”', '”': '”' };

/**
 * O que está entre `{{ }}`: `chave`, `chave | filtro`, `chave | default: 'Cliente'`,
 * `chave || 'Cliente'` (atalho do default), encadeáveis: `contact.name | first | upper || 'Cliente'`.
 * O valor padrão pode vir entre aspas ('…', "…") ou solto (até o próximo `|`).
 * Sintaxe inválida → `null` (o texto fica como foi escrito).
 */
export function parseVariableExpr(expr: string): VariableExpr | null {
  const head = /^\s*([\w.]+)\s*/.exec(expr);
  if (!head) return null;
  const filters: VariableFilter[] = [];
  let i = head[0].length;
  while (i < expr.length) {
    if (expr[i] !== '|') return null;
    const isOr = expr[i + 1] === '|';
    i += isOr ? 2 : 1;
    let name = 'default';
    if (!isOr) {
      const m = /^\s*([a-z_]+)\s*/i.exec(expr.slice(i));
      if (!m) return null;
      name = m[1].toLowerCase();
      i += m[0].length;
      if (expr[i] !== ':') {
        filters.push({ name });
        continue;
      }
      i++;
    }
    const arg = readArg(expr, i);
    if (!arg) return null;
    filters.push({ name, arg: arg.value });
    i = arg.end;
  }
  return { key: head[1], filters };
}

function readArg(s: string, i: number): { value: string; end: number } | null {
  while (/\s/.test(s[i] ?? '')) i++;
  const close = QUOTES[s[i] ?? ''];
  if (close) {
    const end = s.indexOf(close, i + 1);
    if (end < 0) return null;
    let j = end + 1;
    while (/\s/.test(s[j] ?? '')) j++;
    return { value: s.slice(i + 1, end), end: j };
  }
  const next = s.indexOf('|', i);
  const end = next < 0 ? s.length : next;
  const value = s.slice(i, end).trim();
  return value ? { value, end } : null;
}

/**
 * Aplica os filtros em ordem. `default` troca valor vazio/só espaços (ou variável que não
 * existe — `undefined`) pelo argumento; os demais não mexem em `undefined`.
 */
export function applyVariableFilters(value: string | undefined, filters: VariableFilter[]): string | undefined {
  let v = value;
  for (const f of filters) {
    if (f.name === 'default') {
      if ((v ?? '').trim() === '') v = f.arg ?? '';
      continue;
    }
    const filter = VARIABLE_FILTERS[f.name];
    if (v !== undefined && filter) v = filter.apply(v);
  }
  return v;
}

/**
 * Variáveis da empresa (`GlobalVariable`, docs/variaveis.md): valor fixo cadastrado pelo cliente
 * — chave PIX, horário, link do catálogo. Valem como `{{global.<chave>}}` sempre e como
 * `{{<chave>}}` quando não colidem com uma global do sistema.
 */
export const GLOBAL_VARIABLE_PREFIX = 'global.';
export const GLOBAL_VARIABLE_KEY_MAX = 40;
export const GLOBAL_VARIABLE_VALUE_MAX = 2000;
/** Limite por empresa: o contexto de toda mensagem carrega todas. */
export const GLOBAL_VARIABLES_MAX = 200;

/**
 * Nomes que já significam outra coisa no envio: globais do sistema e variáveis que os blocos
 * do fluxo/horário criam. Uma variável da empresa com um desses nomes ficaria escondida.
 */
export const RESERVED_GLOBAL_KEYS = [
  'empresa', 'saudacao', 'greeting', 'faixa', 'proxima_abertura', 'agendamento', 'servico', 'profissional', 'global', 'contact', 'agent', 'company',
] as const;

/** "Chave PIX da Loja" → `chave_pix_da_loja` (mesma regra do campo da ficha), cortada no limite. */
export function globalVarKey(label: string) {
  return attributeVarKey(label).slice(0, GLOBAL_VARIABLE_KEY_MAX).replace(/_+$/, '');
}

/** Erro de uma chave digitada à mão, ou `null` se serve. */
export function globalVarKeyError(key: string): string | null {
  if (!key) return 'Informe a chave';
  if (key.length > GLOBAL_VARIABLE_KEY_MAX) return `Chave com até ${GLOBAL_VARIABLE_KEY_MAX} caracteres`;
  if (!/^[a-z][a-z0-9_]*$/.test(key)) return 'Use só letras minúsculas sem acento, números e _ (começando por letra)';
  if ((RESERVED_GLOBAL_KEYS as readonly string[]).includes(key)) return `"${key}" já é uma variável do sistema`;
  return null;
}
