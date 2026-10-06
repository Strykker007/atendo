import { renderTemplatePreview, type MessageTemplate, type OutboundMessage, type TemplateValues } from '@atendo/shared';

/** Valores do template já interpolados ({{contact.first_name}} etc. resolvidos antes). */
export interface TemplateFill {
  header?: TemplateValues;
  body?: TemplateValues;
}

/**
 * A Cloud API recusa parâmetro com quebra de linha, tab ou mais de 4 espaços seguidos
 * (erro 132018) e com mais de 1024 caracteres — e recusa na entrega, já na fila. Ajustar aqui
 * evita a mensagem "falhou" minutos depois por causa de um Enter no campo.
 */
export function cleanTemplateParam(v: string): string {
  return v.replace(/[\t\r\n]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 1024);
}

function params(keys: string[], values: TemplateValues | undefined, where: string) {
  const faltando = keys.filter((k) => !values?.[k]?.trim());
  if (faltando.length) throw new Error(`Preencha a variável ${faltando.map((k) => `{{${k}}}`).join(', ')} do ${where}.`);
  // variável numérica = posicional; com nome, a Meta exige `parameter_name`
  return keys.map((k) => ({ type: 'text', text: cleanTemplateParam(values![k]), ...(!/^\d+$/.test(k) && { parameter_name: k }) }));
}

/**
 * Template + valores → o que vai para o provider e o texto que fica no histórico do painel.
 * Lança `Error` com mensagem para o atendente quando falta variável ou o template não é enviável.
 */
export function buildTemplateSend(t: MessageTemplate, fill: TemplateFill): { template: NonNullable<OutboundMessage['template']>; text: string } {
  if (t.unsupported) throw new Error(t.unsupported);
  const components: unknown[] = [];
  if (t.headerParams.length) components.push({ type: 'header', parameters: params(t.headerParams, fill.header, 'cabeçalho') });
  if (t.bodyParams.length) components.push({ type: 'body', parameters: params(t.bodyParams, fill.body, 'corpo') });
  const clean = (v?: TemplateValues) => Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, cleanTemplateParam(x)]));
  return {
    template: { name: t.name, language: t.language, category: t.category, ...(components.length && { components }) },
    text: renderTemplatePreview(t, clean(fill.header), clean(fill.body)),
  };
}
