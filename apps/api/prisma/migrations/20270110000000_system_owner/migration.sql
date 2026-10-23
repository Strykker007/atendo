-- Dono do sistema como marcação no usuário (docs/donos-do-sistema.md). Aditiva: começa desligada
-- para todos; super_admin continua dono pelo papel.
ALTER TABLE "users" ADD COLUMN "isSystemOwner" BOOLEAN NOT NULL DEFAULT false;
