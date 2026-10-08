-- CreateTable
CREATE TABLE "tenant_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_templates_name_key" ON "tenant_templates"("name");

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "templateId" TEXT;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "tenant_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
