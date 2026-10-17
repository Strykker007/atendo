/**
 * Mensagem automática ao cliente quando o atendimento muda de mãos (docs/08-frontend.md#transferência).
 * Puro de propósito: a montagem do texto é testada sem banco.
 */

export const DEFAULT_TRANSFER_TEXT = 'Seu atendimento foi transferido para {{atendente}}. Em instantes continuamos por aqui.';
export const DEFAULT_DEPARTMENT_TRANSFER_TEXT = 'Seu atendimento foi encaminhado para o setor {{departamento}}. Em instantes alguém continua por aqui.';

/** Variáveis aceitas no texto. `{{nome}}` é sinônimo de `{{atendente}}`. */
export interface TransferVars {
  /** nome completo de quem recebeu; no texto vai só o primeiro nome */
  agentName?: string | null;
  departmentName?: string | null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/**
 * Texto final, ou null quando não há o que mandar: texto vazio, ou uma variável sem valor
 * (mandar "transferido para ." ao cliente é pior que não mandar nada).
 */
export function buildTransferMessage(template: string | null | undefined, vars: TransferVars): string | null {
  const tpl = (template ?? '').trim();
  if (!tpl) return null;
  let faltou = false;
  const out = tpl.replace(/\{\{\s*(atendente|nome|departamento|setor)\s*\}\}/gi, (_, v: string) => {
    const key = v.toLowerCase();
    const value = key === 'departamento' || key === 'setor' ? vars.departmentName?.trim() : vars.agentName ? firstName(vars.agentName) : '';
    if (!value) faltou = true;
    return value ?? '';
  });
  return faltou ? null : out.trim() || null;
}
