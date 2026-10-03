-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "priceAppliesToExistingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "priceMonth" DECIMAL(10,2);


-- Quem já assina está pagando o preço do plano de hoje: registra isso explicitamente.
-- Sem o preenchimento, `priceMonth` nulo significaria "segue o plano", e o primeiro reajuste
-- faria o painel do cliente mostrar um valor que o Stripe não está cobrando dele.
UPDATE "subscriptions" s
   SET "priceMonth" = p."priceMonth"
  FROM "plans" p
 WHERE p.id = s."planId" AND s."priceMonth" IS NULL;
