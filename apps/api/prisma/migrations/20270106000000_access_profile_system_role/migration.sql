-- The visible name of a built-in profile is tenant vocabulary, not its identity.
ALTER TABLE "access_profiles" ADD COLUMN "systemRole" "Role";

UPDATE "access_profiles"
SET "systemRole" = CASE "name"
  WHEN 'Administrador' THEN 'tenant_admin'::"Role"
  WHEN 'Gerente' THEN 'manager'::"Role"
  WHEN 'Atendente' THEN 'agent'::"Role"
  ELSE NULL
END
WHERE "isSystem" = true;

CREATE UNIQUE INDEX "access_profiles_tenantId_systemRole_key"
  ON "access_profiles"("tenantId", "systemRole");
