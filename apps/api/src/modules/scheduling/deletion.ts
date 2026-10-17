/**
 * Exclusão definitiva de profissional/serviço da agenda (docs/13-agendamento.md#excluir).
 *
 * - Agendamento futuro ativo (marcado/confirmado): nunca exclui — o cliente perderia o horário
 *   sem aviso. Cancele/remarque antes, ou só desative.
 * - Só histórico (passado, cancelado, faltou): exclui apenas com confirmação explícita
 *   (`withHistory`), porque os agendamentos antigos somem junto — e com eles as visitas da ficha
 *   do cliente. Sem a confirmação, a tela oferece desativar, que preserva tudo.
 * - Nunca usado: exclui direto.
 */
export interface DeletionUsage {
  /** agendamentos marcados/confirmados daqui para a frente */
  future: number;
  /** todo o resto (passados ou já encerrados) */
  past: number;
}

export type DeletionVerdict =
  | { ok: true }
  | { ok: false; code: 'has_future' | 'has_history'; message: string };

export function deletionVerdict(what: 'profissional' | 'serviço', u: DeletionUsage, withHistory: boolean): DeletionVerdict {
  if (u.future > 0) {
    return { ok: false, code: 'has_future', message: `Este ${what} tem ${u.future} agendamento(s) futuro(s). Cancele ou remarque antes de excluir — ou apenas desative.` };
  }
  if (u.past > 0 && !withHistory) {
    return { ok: false, code: 'has_history', message: `Este ${what} tem ${u.past} agendamento(s) no histórico, que serão apagados junto. Confirme a exclusão com histórico ou apenas desative.` };
  }
  return { ok: true };
}
