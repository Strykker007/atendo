-- Tolerância para sair: minutos depois do fim do turno em que a sessão ainda funciona (docs/escalas.md)
ALTER TABLE "work_schedules" ADD COLUMN "exitGraceMinutes" INTEGER NOT NULL DEFAULT 0;
