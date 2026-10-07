-- Venda em formato de lista: [{ description, value }]. Nulo = texto livre em "products".
ALTER TABLE "sales" ADD COLUMN "items" JSONB;
