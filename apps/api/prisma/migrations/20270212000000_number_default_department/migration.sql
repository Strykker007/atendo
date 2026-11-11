-- Departamento padrão do número (docs/departamentos.md#departamento-do-número). Coluna opcional:
-- sem valor, nada muda. Apagar o departamento só limpa o vínculo.
ALTER TABLE "whatsapp_numbers" ADD COLUMN "defaultDepartmentId" TEXT;
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_defaultDepartmentId_fkey" FOREIGN KEY ("defaultDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "whatsapp_numbers_defaultDepartmentId_idx" ON "whatsapp_numbers"("defaultDepartmentId");
