import { choose } from '../flows/answer';

/** Opções do lembrete de véspera. Na Meta viram botões; na Evolution, "1 -" / "2 -". */
export const REMINDER_OPTIONS = [
  { id: 'confirm', title: 'Confirmar' },
  { id: 'reschedule', title: 'Remarcar' },
];

/**
 * O que o cliente respondeu ao lembrete: toque no botão, número da opção ou a palavra exata.
 * Roda em **toda** mensagem recebida, então é deliberadamente estrito: nada de casar por
 * pedaço de palavra, senão um "bom dia" viraria pedido de remarcação.
 */
export function reminderChoice(text: string, replyId?: string): 'confirm' | 'reschedule' | undefined {
  const chosen = choose(REMINDER_OPTIONS, text, replyId);
  if (!chosen) return undefined;
  const t = text.trim().toLowerCase();
  if (!replyId && t !== '1' && t !== '2' && t !== chosen.title.toLowerCase()) return undefined;
  return chosen.id as 'confirm' | 'reschedule';
}
