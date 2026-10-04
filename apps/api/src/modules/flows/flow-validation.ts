import { BadRequestException } from '@nestjs/common';
import { CONTENT_MAX_DELAY_SEC, contentMediaError, normalizeCondition, normalizeContent, type FlowDefinition, type FlowNode } from '@atendo/shared';
import { hhmm, opFitsOperand, toNumber } from './conditions';

/** Regras mínimas para um fluxo poder ser salvo/executado. Erros em português para a UI. */
export function validateDefinition(def: FlowDefinition) {
  const errors: string[] = [];
  const starts = def.nodes.filter((n) => n.type === 'start');
  if (starts.length !== 1) errors.push('O fluxo precisa de exatamente um nó "Início".');
  const ids = new Set(def.nodes.map((n) => n.id));
  for (const e of def.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) errors.push('Há uma conexão apontando para um nó que não existe.');
  }
  for (const n of def.nodes) {
    if (n.type === 'message') errors.push(...contentErrors(n));
    if (n.type === 'connect_flow' && !n.data.flowId && !(n.data as { _reconfig?: unknown })._reconfig) errors.push(`"Conectar com outro fluxo" (${n.id}): escolha o fluxo de destino.`);
    // texto é opcional: "Salvar" pode só esperar a resposta de uma pergunta feita antes
    if (n.type === 'question' && !n.data.varName) errors.push(`"Salvar" (${n.id}) precisa do nome da variável.`);
    if (n.type === 'variable') {
      if (!n.data.assignments?.some((a) => a.varName)) errors.push(`"Manipulador" (${n.id}) precisa de ao menos uma variável.`);
      if (n.data.assignments?.some((a) => a.varName && a.op === 'copy' && !a.from)) errors.push(`"Manipulador" (${n.id}): escolha de qual variável copiar.`);
      // somar/subtrair só aceita número; com {{variável}} o valor só é conhecido na execução
      // (lá, valor que não é número não altera a variável)
      for (const a of n.data.assignments ?? []) {
        if (!a.varName || (a.op !== 'add' && a.op !== 'subtract') || /\{\{/.test(a.value ?? '')) continue;
        if (Number.isNaN(toNumber(a.value ?? ''))) errors.push(`"Manipulador" (${n.id}): "${a.value ?? ''}" não é um número para ${a.op === 'add' ? 'somar' : 'subtrair'} em {{${a.varName}}}.`);
      }
    }
    if (n.type === 'condition') errors.push(...conditionErrors(n));
    if (n.type === 'randomizer' && ((n.data.branches?.length ?? 0) < 2 || !n.data.branches.some((b) => Number(b.weight) > 0))) errors.push(`"Randomizador" (${n.id}) precisa de pelo menos dois ramos, com algum peso maior que zero.`);
    if (n.type === 'action' && n.data.kind === 'webhook' && !(n.data as { _reconfig?: unknown })._reconfig && !/^https?:\/\//i.test(n.data.url ?? '')) errors.push(`"Ação" (${n.id}) de webhook precisa de uma URL http(s).`);
    if (n.type === 'menu' && (!n.data.text || !n.data.options?.length)) errors.push(`"Menu" (${n.id}) precisa de texto e ao menos uma opção.`);
    if (n.type === 'start' && !def.edges.some((e) => e.source === n.id)) errors.push('O nó "Início" não está conectado a nada.');
    if (n.type === 'ai') {
      if (!n.data.instructions?.trim()) errors.push(`"IA" (${n.id}) precisa das instruções do negócio.`);
      if (n.data.mode === 'classify' && !n.data.labels?.length) errors.push(`"IA" (${n.id}) em modo classificar precisa de pelo menos um rótulo.`);
      // sem saída de fallback, uma indisponibilidade da IA deixaria o contato sem resposta
      if (!def.edges.some((e) => e.source === n.id && e.sourceHandle === 'fallback')) {
        errors.push(`"IA" (${n.id}) precisa da saída "Não conseguiu" conectada — é ela que entrega para um humano quando a IA falha.`);
      }
    }
  }
  if (errors.length) throw new BadRequestException(errors.join(' '));
}

/** Condição: cada ramo com regras completas. Formato antigo passa pela mesma conversão do motor. */
function conditionErrors(n: Extract<FlowNode, { type: 'condition' }>): string[] {
  const out: string[] = [];
  const branches = normalizeCondition(n.data);
  if (!branches.length) out.push(`"Condição" (${n.id}) precisa de ao menos um ramo.`);
  for (const b of branches) {
    const name = `"Condição" (${n.id}), ramo "${b.label || b.id}"`;
    if (!b.rules?.length) { out.push(`${name} precisa de ao menos uma regra.`); continue; }
    for (const r of b.rules) {
      if (!opFitsOperand(r)) out.push(`${name}: comparador inválido para o operando.`);
      else if ((r.operand === 'var' || r.operand === 'contact') && !r.key) out.push(`${name}: escolha a variável ou o campo do contato.`);
      else if (r.op === 'weekday_in' && !r.days?.length) out.push(`${name}: escolha ao menos um dia da semana.`);
      else if (r.op === 'time_between' && (Number.isNaN(hhmm(r.from)) || Number.isNaN(hhmm(r.to)))) out.push(`${name}: horário deve ser HH:MM.`);
      // etiqueta que saiu na importação: o card já mostra "Reconfigurar"; não trava o salvar
      else if (r.operand === 'tag' && !r.tagId && !(n.data as { _reconfig?: unknown })._reconfig) out.push(`${name}: escolha a etiqueta.`);
    }
  }
  return out;
}

/** Conteúdo: cada mensagem preenchida e dentro dos limites do WhatsApp. Formato antigo passa pela mesma leitura do motor. */
function contentErrors(n: Extract<FlowNode, { type: 'message' }>): string[] {
  const items = normalizeContent(n.data);
  const reconfig = !!(n.data as { _reconfig?: unknown })._reconfig;
  if (!items.length) return [`"Conteúdo" (${n.id}) está vazio.`];
  const out: string[] = [];
  items.forEach((it, i) => {
    const name = `"Conteúdo" (${n.id}), mensagem ${i + 1}`;
    if (it.kind === 'text') {
      if (!it.text?.trim()) out.push(`${name}: o texto está vazio.`);
    } else if (!it.mediaKey) {
      // anexo que saiu na importação: o card já mostra "Reconfigurar"; não trava o salvar
      if (!reconfig) out.push(`${name}: envie o arquivo.`);
    } else {
      const err = contentMediaError(it.kind, it.mimeType, it.size);
      if (err) out.push(`${name}: ${err}`);
    }
    const d = Number(it.delay ?? 0);
    if (Number.isNaN(d) || d < 0 || d > CONTENT_MAX_DELAY_SEC) out.push(`${name}: o intervalo deve ser de 0 a ${CONTENT_MAX_DELAY_SEC} segundos.`);
  });
  return out;
}

/**
 * Anexos do Conteúdo precisam ser do próprio cliente: a chave carrega o tenant
 * (`media/<tenantId>/…`) e o motor envia o que estiver nela.
 */
export function assertOwnFlowMedia(tenantId: string, def: FlowDefinition) {
  for (const n of def.nodes) {
    if (n.type !== 'message') continue;
    for (const it of normalizeContent(n.data)) {
      if (it.mediaKey && !it.mediaKey.startsWith(`media/${tenantId}/`)) throw new BadRequestException(`"Conteúdo" (${n.id}): arquivo inválido.`);
    }
  }
}
