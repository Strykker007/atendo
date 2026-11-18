/**
 * Vocabulário da operação (docs/38-segmentos.md). Com venda (`salesEnabled`): "consultor" e "lead".
 * Sem venda (condomínio, escritório, suporte): "atendente" e "contato". Puro, para a tela e os testes.
 */
export interface SalesVocab {
  vendas: boolean;
  pessoa: string;
  pessoas: string;
  lead: string;
  leads: string;
}

export function salesVocab(salesEnabled: boolean): SalesVocab {
  return salesEnabled
    ? { vendas: true, pessoa: 'Consultor', pessoas: 'consultores', lead: 'lead', leads: 'leads' }
    : { vendas: false, pessoa: 'Atendente', pessoas: 'atendentes', lead: 'contato', leads: 'contatos' };
}
