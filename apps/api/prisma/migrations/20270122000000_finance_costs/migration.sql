-- Custos completos no fechamento (docs/36-fechamento-financeiro.md): categorias cadastráveis,
-- fornecedores, contas a pagar (vencimento x pagamento), parcelas e impostos automáticos.
-- Aditiva: tabelas e colunas novas; os lançamentos que já existem ficam pagos na data deles.

CREATE TABLE "finance_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finance_categories_pkey" PRIMARY KEY ("id")
);

-- de fábrica: o id é a chave que os lançamentos já usavam
INSERT INTO "finance_categories" ("id", "name", "section", "system") VALUES
    ('mensalidade',    'Mensalidade recebida por fora',     'revenue',   true),
    ('instalacao',     'Instalação / implantação',          'revenue',   true),
    ('servico',        'Serviço avulso',                    'revenue',   true),
    ('outros_entrada', 'Outras entradas',                   'revenue',   true),
    ('das',            'Simples Nacional (DAS)',            'tax',       true),
    ('iss',            'ISS',                               'tax',       true),
    ('pis_cofins',     'PIS / COFINS',                      'tax',       true),
    ('irpj_csll',      'IRPJ / CSLL',                       'tax',       true),
    ('impostos',       'Outros impostos',                   'tax',       true),
    ('taxas_gov',      'Taxas, alvarás e certidões',        'tax',       true),
    ('infra',          'Servidores e infraestrutura',       'cost',      true),
    ('meta',           'Meta / WhatsApp',                   'cost',      true),
    ('taxas',          'Taxas de cobrança (Asaas, banco)',  'cost',      true),
    ('ferramentas',    'Ferramentas e assinaturas',         'expense',   true),
    ('marketing',      'Marketing e anúncios',              'expense',   true),
    ('contabilidade',  'Contabilidade',                     'expense',   true),
    ('aluguel',        'Aluguel, escritório e contas',      'expense',   true),
    ('juridico',       'Jurídico',                          'expense',   true),
    ('juros',          'Juros, tarifas e empréstimos',      'expense',   true),
    ('outros_saida',   'Outras despesas',                   'expense',   true),
    ('folha',          'Salários',                          'payroll',   true),
    ('encargos',       'Encargos (INSS, FGTS)',             'payroll',   true),
    ('beneficios',     'Benefícios (VT, VR, plano)',        'payroll',   true),
    ('comissoes',      'Comissões',                         'payroll',   true),
    ('prolabore',      'Pró-labore',                        'prolabore', true);

CREATE TABLE "finance_suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "pixKey" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "finance_suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "finance_tax_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "percent" DECIMAL(6,3) NOT NULL,
    "base" TEXT NOT NULL DEFAULT 'all',
    "dueDay" INTEGER NOT NULL DEFAULT 20,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startPeriod" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "finance_tax_rules_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "finance_entries"
    ADD COLUMN "paidAt" TIMESTAMP(3),
    ADD COLUMN "paymentMethod" TEXT,
    ADD COLUMN "documentNumber" TEXT,
    ADD COLUMN "notes" TEXT,
    ADD COLUMN "supplierId" TEXT,
    ADD COLUMN "installmentGroup" TEXT,
    ADD COLUMN "installmentNo" INTEGER,
    ADD COLUMN "installmentTotal" INTEGER,
    ADD COLUMN "taxRuleId" TEXT,
    ADD COLUMN "amountLocked" BOOLEAN NOT NULL DEFAULT false;
-- até aqui todo lançamento era dinheiro que já entrou/saiu
UPDATE "finance_entries" SET "paidAt" = "date" WHERE "paidAt" IS NULL;
CREATE UNIQUE INDEX "finance_entries_taxRuleId_period_key" ON "finance_entries"("taxRuleId", "period");
CREATE INDEX "finance_entries_paidAt_idx" ON "finance_entries"("paidAt");
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "finance_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_taxRuleId_fkey" FOREIGN KEY ("taxRuleId") REFERENCES "finance_tax_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "finance_recurring"
    ADD COLUMN "endPeriod" TEXT,
    ADD COLUMN "frequency" TEXT NOT NULL DEFAULT 'monthly',
    ADD COLUMN "autoPaid" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "paymentMethod" TEXT,
    ADD COLUMN "supplierId" TEXT,
    ADD COLUMN "notes" TEXT;
-- os fixos de antes entravam como já pagos: continuam assim
UPDATE "finance_recurring" SET "autoPaid" = true;
ALTER TABLE "finance_recurring" ADD CONSTRAINT "finance_recurring_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "finance_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
