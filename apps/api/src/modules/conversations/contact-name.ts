import type { ContactNameSource } from '@prisma/client';

/** Evita tratar diferenças de espaços da agenda como mudança de nome. */
export function normalizeContactName(name?: string | null): string {
  return (name ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * O pushName que chega na mensagem pode trocar o nome do contato?
 *
 * Prioridade: manual (ficha, fluxo) > agenda > whatsapp. O pushName é o nível mais baixo: só
 * troca nome que também veio do WhatsApp, ou preenche quem ainda não tem nome.
 */
export function pushNameTrocaNome(contact: { name: string | null; nameSource: ContactNameSource }, pushName?: string | null): boolean {
  const novo = normalizeContactName(pushName);
  if (!novo || novo === normalizeContactName(contact.name)) return false;
  return !contact.name || contact.nameSource === 'whatsapp';
}

/**
 * Nome vindo da sincronização de contatos vira nome da AGENDA?
 *
 * O mesmo evento traz o nome salvo no celular ou só o pushName repetido. `jaVeioEmMensagem` =
 * o contato já mandou mensagem com exatamente esse pushName: aí não é agenda, e o caminho das
 * mensagens já cuida dele. Nome manual nunca é trocado.
 */
export function nomeDaAgendaTroca(contact: { name: string | null; nameSource: ContactNameSource }, nome: string, jaVeioEmMensagem: boolean): boolean {
  const novo = normalizeContactName(nome);
  if (!novo || novo === normalizeContactName(contact.name) || jaVeioEmMensagem) return false;
  return contact.nameSource !== 'manual' || !contact.name;
}

/**
 * Entre os registros de agenda de um telefone (um por número de WhatsApp do cliente), qual vale:
 * o da agenda do número onde a conversa acontece; senão o atualizado mais recentemente.
 */
export function escolherDaAgenda<T extends { numberId: string; name: string; updatedAt: Date }>(entradas: T[], numberId: string): T | undefined {
  return entradas.find((e) => e.numberId === numberId) ?? [...entradas].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
}

type EntradaDaAgenda = { name: string; previousName: string | null };

/**
 * Como fica o registro da agenda (`phonebook_entries`) com um nome vindo da sincronização.
 * `null` = nada a gravar. Toda troca guarda o nome anterior: a Evolution tem UM nome por contato
 * e o troca pelo nome de perfil do WhatsApp, então uma "troca de agenda" pode ser só isso.
 */
export function trocaNaAgenda(atual: EntradaDaAgenda | null, nome: string): EntradaDaAgenda | null {
  const novo = normalizeContactName(nome);
  if (!novo) return null;
  if (!atual) return { name: novo, previousName: null };
  if (normalizeContactName(atual.name) === novo) return null;
  return { name: novo, previousName: normalizeContactName(atual.name) };
}

/**
 * Chegou mensagem com pushName IGUAL ao nome atual da agenda, e há um nome anterior: a última
 * troca era o nome de perfil do WhatsApp chegando pela sincronização (a pessoa mudou o nome dela
 * sem mandar mensagem), não a agenda do celular. Devolve o nome a restaurar, ou `null`.
 */
export function agendaParaRestaurar(entrada: EntradaDaAgenda, pushName?: string | null): string | null {
  const p = normalizeContactName(pushName);
  if (!p || !entrada.previousName || normalizeContactName(entrada.name) !== p || normalizeContactName(entrada.previousName) === p) return null;
  return normalizeContactName(entrada.previousName);
}

