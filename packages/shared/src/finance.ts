/**
 * Fechamento financeiro do dono (docs/36-fechamento-financeiro.md).
 *
 * As categorias são cadastráveis (`finance_categories`); o que é fixo é o GRUPO de cada uma, que
 * decide a linha do fechamento (DRE simplificado): entradas − impostos − custos do serviço −
 * despesas − folha − pró-labore = resultado.
 */
export const FINANCE_SECTIONS = ['revenue', 'tax', 'cost', 'expense', 'payroll', 'prolabore'] as const;
export type FinanceSection = (typeof FINANCE_SECTIONS)[number];

export const FINANCE_SECTION_LABEL: Record<FinanceSection, string> = {
  revenue: 'Entradas',
  tax: 'Impostos',
  cost: 'Custos do serviço',
  expense: 'Despesas',
  payroll: 'Folha e encargos',
  prolabore: 'Pró-labore',
};
export const FINANCE_SECTION_HINT: Record<FinanceSection, string> = {
  revenue: 'Dinheiro que entra além das mensalidades do Asaas/Stripe',
  tax: 'DAS, ISS, PIS/COFINS, IRPJ/CSLL, taxas e alvarás',
  cost: 'O que o serviço consome para rodar: servidores, Meta, taxas de cobrança',
  expense: 'Ferramentas, marketing, contador, aluguel, jurídico, juros',
  payroll: 'Salários, encargos (INSS, FGTS), benefícios e comissões',
  prolabore: 'Retirada fixa dos sócios que trabalham na empresa',
};

export type FinanceEntryKind = 'income' | 'expense';
export const financeKindOf = (s: FinanceSection): FinanceEntryKind => (s === 'revenue' ? 'income' : 'expense');

export const FINANCE_PAYMENT_METHODS = ['pix', 'boleto', 'cartao_credito', 'cartao_debito', 'debito_automatico', 'transferencia', 'dinheiro'] as const;
export type FinancePaymentMethod = (typeof FINANCE_PAYMENT_METHODS)[number];
export const FINANCE_PAYMENT_METHOD_LABEL: Record<FinancePaymentMethod, string> = {
  pix: 'Pix',
  boleto: 'Boleto',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  debito_automatico: 'Débito automático',
  transferencia: 'Transferência / TED',
  dinheiro: 'Dinheiro',
};

/** custo fixo: de quanto em quanto tempo se repete (a partir do mês de início) */
export const FINANCE_FREQUENCIES = ['monthly', 'quarterly', 'semiannual', 'yearly'] as const;
export type FinanceFrequency = (typeof FINANCE_FREQUENCIES)[number];
export const FINANCE_FREQUENCY_LABEL: Record<FinanceFrequency, string> = { monthly: 'Todo mês', quarterly: 'A cada 3 meses', semiannual: 'A cada 6 meses', yearly: 'Uma vez por ano' };
export const FINANCE_FREQUENCY_MONTHS: Record<FinanceFrequency, number> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };

/** imposto automático: sobre o que ele incide no mês */
export const FINANCE_TAX_BASES = ['all', 'clients'] as const;
export type FinanceTaxBase = (typeof FINANCE_TAX_BASES)[number];
export const FINANCE_TAX_BASE_LABEL: Record<FinanceTaxBase, string> = { all: 'Tudo que entrou no mês', clients: 'Só o recebido de clientes' };
