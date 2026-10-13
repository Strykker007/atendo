/**
 * Tags de encerramento com que todo cliente novo nasce (fora do Kanban). Eram a lista de
 * "motivos de perda", que virou tag (docs/06-modelo-de-dados.md). "Outros" fica por último de
 * propósito: é a saída de quem não achou a tag certa.
 */
export const DEFAULT_LOSS_REASONS = [
  'Não respondeu',
  'Achou caro',
  'Falta de estoque',
  'Desistiu',
  'Só pesquisando',
  'Comprou em outro lugar',
  'Vai vir na loja',
  'Fora da área de entrega',
  'Produto não comercializado',
  'Outros',
];

/** limite de tags de encerramento num modelo de perfil */
export const LOSS_REASONS_MAX = 30;
