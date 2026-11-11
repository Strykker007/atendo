-- Hierarquia de departamentos (docs/departamentos.md#hierarquia). Aditiva: todos começam no topo.
ALTER TABLE "departments" ADD COLUMN "parentId" TEXT;
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "departments_parentId_idx" ON "departments"("parentId");
