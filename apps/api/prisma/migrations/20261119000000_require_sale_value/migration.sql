-- "Comprou" exige valor — configurável por empresa (padrão: exige, como sempre foi).
ALTER TABLE "tenant_settings" ADD COLUMN "requireSaleValue" BOOLEAN NOT NULL DEFAULT true;
