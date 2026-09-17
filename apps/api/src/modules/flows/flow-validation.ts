import { BadRequestException } from '@nestjs/common';
import type { FlowDefinition } from '@atendo/shared';

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
    if (n.type === 'message' && !n.data.text && !n.data.mediaKey) errors.push(`"Enviar mensagem" (${n.id}) está vazio.`);
    if (n.type === 'question' && (!n.data.text || !n.data.varName)) errors.push(`"Perguntar" (${n.id}) precisa de texto e nome da variável.`);
    if (n.type === 'menu' && (!n.data.text || !n.data.options?.length)) errors.push(`"Menu" (${n.id}) precisa de texto e ao menos uma opção.`);
    if (n.type === 'start' && !def.edges.some((e) => e.source === n.id)) errors.push('O nó "Início" não está conectado a nada.');
  }
  if (errors.length) throw new BadRequestException(errors.join(' '));
}
