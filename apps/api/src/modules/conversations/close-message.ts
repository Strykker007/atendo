/**
 * Mensagem automática ao cliente quando o atendente encerra (docs/08-frontend.md#aviso-de-encerramento).
 * Mesmas variáveis e mesma regra da transferência: variável sem valor = não manda.
 */
import { buildTransferMessage } from './transfer-message';

export const DEFAULT_CLOSE_TEXT = 'Seu atendimento foi encerrado. Obrigado pelo contato! Se precisar de algo, é só mandar uma mensagem por aqui.';

/** Texto final, ou null quando não há o que mandar. `{{atendente}}` = primeiro nome de quem atendeu. */
export const buildCloseMessage = (template: string | null | undefined, agentName?: string | null) => buildTransferMessage(template, { agentName });
