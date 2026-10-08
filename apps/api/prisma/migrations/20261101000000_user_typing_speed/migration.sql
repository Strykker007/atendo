-- velocidade do "digitando…" simulado de cada atendente (slow | normal | fast)
ALTER TABLE "users" ADD COLUMN "typingSpeed" TEXT NOT NULL DEFAULT 'normal';
