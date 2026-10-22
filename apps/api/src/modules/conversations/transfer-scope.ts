import { effectiveNumberIds } from '../auth/company-scope';
import { canSeeDepartment } from '../auth/department-scope';
import { canUseNumber } from '../auth/number-scope';

/**
 * Quem pode receber uma transferência: quem conseguiria abrir a conversa. Mesma régua do
 * `ConversationScopeGuard` (número + departamento), só que aplicada ao **destino**, que não está
 * na requisição — o escopo dele é montado aqui como o `JwtAuthGuard` monta o de quem loga.
 *
 * A empresa (filial) entra pelos números, sem a empresa selecionada no seletor: quem recebe
 * atende pelo mesmo número da conversa, então basta operar esse número em alguma das empresas
 * dele. Quem tem "todos os números" e nenhuma empresa vinculada recebe de qualquer filial —
 * é o apoio entre unidades (docs/empresas.md#transferência).
 */
export interface TransferTargetScope {
  role: string;
  permissions: readonly string[];
  /** `UserNumber`; vazio = todos */
  numberIds: readonly string[];
  /** `UserCompany`; vazio = todas */
  companyIds: readonly string[];
  departmentIds: readonly string[];
}

export function canReceiveTransfer(
  target: TransferTargetScope,
  conv: { numberId: string; departmentId: string | null },
  companyNumbers: ReadonlyMap<string, readonly string[]>,
): boolean {
  const numberIds = companyNumbers.size
    ? effectiveNumberIds({ userNumberIds: target.numberIds, userCompanyIds: target.companyIds, companyNumbers }).numberIds
    : target.numberIds;
  return canUseNumber({ role: target.role, numberIds }, conv.numberId) && canSeeDepartment(target, conv.departmentId);
}
