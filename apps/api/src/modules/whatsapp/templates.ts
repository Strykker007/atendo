import { renderTemplatePreview, templateHeaderMedia, type MessageTemplate, type OutboundMessage, type TemplateValues } from '@atendo/shared';

/** Valores do template já interpolados ({{contact.first_name}} etc. resolvidos antes). */
export interface TemplateFill {
  header?: TemplateValues;
  body?: TemplateValues;
  /** valor de cada botão dinâmico (final da URL ou cupom), pela posição do botão */
  buttons?: TemplateValues;
  /** arquivo do cabeçalho de mídia (chave do storage, já conferida como do tenant) */
  headerMedia?: { key: string; name?: string };
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
export function buildTemplateSend(t: MessageTemplate, fill: TemplateFill): { template: NonNullable<OutboundMessage['template']>; text: string; media?: { key: string; type: 'image' | 'video' | 'document'; name?: string } } {
  if (t.unsupported) throw new Error(t.unsupported);
  const headerMedia = templateHeaderMedia(t);
  if (headerMedia && !fill.headerMedia?.key) throw new Error(`Anexe ${headerMedia === 'image' ? 'a imagem' : headerMedia === 'video' ? 'o vídeo' : 'o documento'} do cabeçalho do template.`);
  const components: unknown[] = [];
  if (t.headerParams.length) components.push({ type: 'header', parameters: params(t.headerParams, fill.header, 'cabeçalho') });
  if (t.bodyParams.length) components.push({ type: 'body', parameters: params(t.bodyParams, fill.body, 'corpo') });
  for (const b of t.dynamicButtons ?? []) {
    const v = fill.buttons?.[String(b.index)]?.trim();
    if (!v) throw new Error(`Preencha o ${b.kind === 'url' ? 'final do link' : 'código'} do botão "${b.text}".`);
    // botão de link: só o trecho dinâmico (a Meta junta com a URL aprovada); cupom: até 15 caracteres
    const parameter = b.kind === 'url' ? { type: 'text', text: cleanTemplateParam(v) } : { type: 'coupon_code', coupon_code: cleanTemplateParam(v).slice(0, 15) };
    components.push({ type: 'button', sub_type: b.kind, index: String(b.index), parameters: [parameter] });
  }
  const clean = (v?: TemplateValues) => Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, cleanTemplateParam(x)]));
  return {
    template: { name: t.name, language: t.language, category: t.category, ...(components.length && { components }), ...(headerMedia && { headerMedia }) },
    text: renderTemplatePreview(t, clean(fill.header), clean(fill.body)),
    ...(headerMedia && fill.headerMedia && { media: { key: fill.headerMedia.key, type: headerMedia, name: fill.headerMedia.name } }),
  };
}
