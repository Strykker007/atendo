-- CPF/CNPJ na ficha do contato, para o Pix automático do orçamento (docs/orcamentos.md#pix-automático)
ALTER TABLE "contacts" ADD COLUMN "document" TEXT;
