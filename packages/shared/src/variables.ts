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
  { key: 'contact.phone', label: 'Telefone do contato' },
  { key: 'contact.email', label: 'E-mail do contato (da ficha)' },
  { key: 'contact.address', label: 'Endereço do contato (da ficha)' },
  { key: 'contact.note1', label: 'Observação 1 do contato (da ficha)' },
  { key: 'contact.note2', label: 'Observação 2 do contato (da ficha)' },
  { key: 'empresa', label: 'Nome da empresa', aliases: ['company.name'] },
  { key: 'saudacao', label: 'Bom dia / Boa tarde / Boa noite', aliases: ['greeting'] },
];

/** Campos fixos da ficha — um campo livre com o mesmo nome não os sobrescreve. */
export const CONTACT_FIXED_KEYS = ['name', 'first_name', 'phone', 'email', 'address', 'note1', 'note2'] as const;

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
