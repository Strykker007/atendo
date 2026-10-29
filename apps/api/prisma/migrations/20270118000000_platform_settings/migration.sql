-- Configurações da plataforma (uma linha). Aditiva: tabela nova; sem linha = tudo no padrão
-- (cobrança por Pix escondida dos clientes).
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "asaasClientBilling" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
