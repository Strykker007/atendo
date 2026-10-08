/**
 * Motivos de perda com que todo cliente novo nasce (Configurações → Motivos de perda). A ordem é
 * a dos chips no encerramento "Não comprou". "Outros" fica por último de propósito: é a saída
 * de quem não achou o motivo, e no topo viraria a resposta preguiçosa que esvazia o relatório.
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

/** limite da API (`SettingsDto.lossReasons`) */
export const LOSS_REASONS_MAX = 30;
