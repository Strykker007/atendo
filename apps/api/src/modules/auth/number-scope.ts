/**
 * Quais números o usuário opera.
 *
 * É escopo de **dados**, não permissão: "pode configurar números" (`numbers.manage`) é
 * diferente de "só atende pelo número da filial Centro". Por isso vive fora do catálogo.
 *
 * A regra central é uma só, e precisa ser óbvia: **lista vazia = todos os números**. Esse é
 * o estado de quem nunca foi restringido e do cliente que tem um número só. Se vazio
 * significasse "nenhum", ativar a funcionalidade trancaria a equipe inteira para fora do
 * atendimento no primeiro deploy.
 */

export interface Scoped {
  role: string;
  /** ids dos números vinculados ao usuário; vazio = sem restrição */
  numberIds?: readonly string[];
}

/** Sem restrição? Dono do sistema e quem não tem vínculo nenhum operam tudo. */
export function unrestricted(user: Scoped): boolean {
  return user.role === 'super_admin' || !user.numberIds?.length;
}

export function canUseNumber(user: Scoped, numberId: string | null | undefined): boolean {
  if (unrestricted(user)) return true;
  return !!numberId && user.numberIds!.includes(numberId);
}

/**
 * Filtro para o Prisma. `undefined` quando não há restrição — assim a consulta não ganha
 * um `in` gigante à toa no caso mais comum, que é o cliente com um número só.
 */
export function numberFilter(user: Scoped): { in: string[] } | undefined {
  return unrestricted(user) ? undefined : { in: [...user.numberIds!] };
}

/**
 * Interseção do que o usuário pediu (um número ou vários) com o que ele pode ver. Devolve `null` quando o pedido
 * não sobra nada — quem chama transforma isso em "lista vazia", nunca em "sem filtro":
 * ignorar o pedido mostraria justamente os números que a pessoa não deveria ver.
 */
export function narrowTo(user: Scoped, requested?: string | readonly string[] | null): { in: string[] } | string | null | undefined {
  // vários números no filtro (docs/18-perfis-de-acesso.md#número-padrão): "a,b" ou lista
  const pedidos = [...new Set((typeof requested === 'string' ? requested.split(',') : (requested ?? [])).map((s) => s.trim()).filter(Boolean))];
  if (!pedidos.length) return numberFilter(user);
  const ok = pedidos.filter((id) => canUseNumber(user, id));
  if (!ok.length) return null;
  return ok.length === 1 ? ok[0] : { in: ok };
}

/**
 * Quem pode **gerenciar a conexão** (QR, reconectar, desconectar, trocar provider, excluir) de
 * um número. `numbers.manage` diz "pode mexer em números"; isto diz "em qual".
 *
 * O admin da conta (e o dono do sistema, inclusive entrando como o cliente) mexe em qualquer
 * número — mesmo que tenha sido restringido para atender só alguns: ele responde pela conta
 * inteira. Os demais só nos números que operam (lista vazia = todos, como em `canUseNumber`).
 */
export function canManageNumber(user: Scoped & { impersonatorId?: string }, numberId: string | null | undefined): boolean {
  if (user.role === 'tenant_admin' || user.impersonatorId) return true;
  return canUseNumber(user, numberId);
}
