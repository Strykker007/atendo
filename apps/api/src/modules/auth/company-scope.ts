/**
 * Empresa/unidade como escopo de dados (docs/empresas.md).
 *
 * A empresa não ganha filtro próprio em cada consulta: ela vira **números**. Uma empresa é um
 * conjunto de números, e todo o sistema já sabe restringir por número (`number-scope.ts`) —
 * conversas, contadores, kanban, envio. Converter aqui, uma vez, na entrada da requisição, é o
 * que garante que nenhuma tela esqueça de respeitar a unidade selecionada.
 */

/** Header com a empresa escolhida no seletor do painel. Ausente = todas as que a pessoa opera. */
export const COMPANY_HEADER = 'x-company-id';

/**
 * Id que não existe em número nenhum. `numberIds` vazio significa "todos" (ver number-scope.ts),
 * então quando a interseção não sobra nada a lista precisa de um item que não casa com nada —
 * senão a unidade sem número mostraria as conversas de todas as outras.
 */
export const NO_NUMBER = '00000000-0000-0000-0000-000000000000';

export interface CompanyScopeInput {
  /** números vinculados direto ao usuário (`UserNumber`); vazio = sem restrição */
  userNumberIds: readonly string[];
  /** empresas vinculadas ao usuário (`UserCompany`); vazio = todas */
  userCompanyIds: readonly string[];
  /** empresas do cliente → números de cada uma */
  companyNumbers: ReadonlyMap<string, readonly string[]>;
  /** empresa pedida pelo seletor (header); ignorada se a pessoa não opera essa empresa */
  activeCompanyId?: string | null;
}

/** Empresas que a pessoa pode selecionar. Sem vínculo = todas as do cliente. */
export function allowedCompanies(userCompanyIds: readonly string[], companyNumbers: ReadonlyMap<string, unknown>): string[] {
  const todas = [...companyNumbers.keys()];
  return userCompanyIds.length ? userCompanyIds.filter((id) => companyNumbers.has(id)) : todas;
}

/**
 * Números que a pessoa enxerga nesta requisição: o vínculo direto com números, cruzado com o das
 * empresas, cruzado com a empresa selecionada. Devolve no formato de `AuthUser.numberIds`
 * (vazio = todos; `[NO_NUMBER]` = nenhum).
 */
export function effectiveNumberIds(input: CompanyScopeInput): { numberIds: string[]; companyId: string | null } {
  const { userNumberIds, userCompanyIds, companyNumbers, activeCompanyId } = input;
  const permitidas = allowedCompanies(userCompanyIds, companyNumbers);
  const ativa = activeCompanyId && permitidas.includes(activeCompanyId) ? activeCompanyId : null;

  // conjunto de números que as empresas liberam; null = empresa não restringe nada
  let daEmpresa: Set<string> | null = null;
  if (ativa) daEmpresa = new Set(companyNumbers.get(ativa) ?? []);
  else if (userCompanyIds.length) daEmpresa = new Set(permitidas.flatMap((id) => companyNumbers.get(id) ?? []));

  if (!daEmpresa) return { numberIds: [...userNumberIds], companyId: null };
  const final = userNumberIds.length ? userNumberIds.filter((id) => daEmpresa!.has(id)) : [...daEmpresa];
  return { numberIds: final.length ? final : [NO_NUMBER], companyId: ativa };
}
