-- Template (Meta) do lembrete da Agenda fora da janela de 24h (docs/13-agendamento.md).
ALTER TABLE "scheduling_settings" ADD COLUMN "reminderTemplate" JSONB;
