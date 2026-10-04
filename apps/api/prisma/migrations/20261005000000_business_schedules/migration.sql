-- Quadro de horários, faixas e boas-vindas (tarefa 2, docs/horarios.md).
-- Converte o expediente antigo (`business_hours` + `outsideHoursText`) num quadro padrão por
-- cliente, com o mesmo resultado para quem não mexer em nada:
--   * cada intervalo vira um intervalo da faixa "Aberto" (comportamento: atendimento normal);
--   * intervalo antigo que "virava a meia-noite" (18:00–02:00) valia, no MESMO dia da semana,
--     00:00–02:00 e 18:00–24:00 — é dividido nesses dois pedaços (no modelo novo, 18:00–02:00
--     iria até as 02:00 do dia seguinte);
--   * cliente sem nenhum intervalo era "sempre aberto" → todos os dias 00:00–00:00 (24h) "Aberto";
--   * o aviso de fora do expediente vira a mensagem da faixa Fechado, com o comportamento
--     "enviar só se nenhum fluxo responder" (exatamente quando o aviso antigo saía).

CREATE TABLE "business_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "business_schedules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "business_schedules_tenantId_idx" ON "business_schedules"("tenantId");
ALTER TABLE "business_schedules" ADD CONSTRAINT "business_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_numbers" ADD COLUMN "scheduleId" TEXT;
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "business_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversations" ADD COLUMN "scheduleNoticeKey" TEXT;

ALTER TABLE "tenant_settings" ADD COLUMN "attendanceChangedAt" TIMESTAMP(3),
ADD COLUMN "welcomeMessages" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "welcomeMode" TEXT NOT NULL DEFAULT 'random',
ADD COLUMN "welcomeCursor" INTEGER NOT NULL DEFAULT 0;

-- ---- dados ----
WITH parts AS (
  SELECT "tenantId", "weekday", "start" AS s, "end" AS e FROM "business_hours" WHERE "end" > "start"
  UNION ALL SELECT "tenantId", "weekday", '00:00', '00:00' FROM "business_hours" WHERE "end" = "start"
  UNION ALL SELECT "tenantId", "weekday", '00:00', "end" FROM "business_hours" WHERE "end" < "start" AND "end" <> '00:00'
  UNION ALL SELECT "tenantId", "weekday", "start", '00:00' FROM "business_hours" WHERE "end" < "start"
),
tenants AS (
  SELECT "tenantId" FROM "tenant_settings" UNION SELECT "tenantId" FROM "business_hours"
),
has_hours AS (SELECT DISTINCT "tenantId" FROM "business_hours"),
day_json AS (
  SELECT t."tenantId", d.wd,
    CASE WHEN h."tenantId" IS NULL
      THEN jsonb_build_array(jsonb_build_object('id', 'm' || d.wd, 'start', '00:00', 'end', '00:00', 'bandId', 'open'))
      ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', substr(md5(random()::text || p.s || p.e), 1, 8), 'start', p.s, 'end', p.e, 'bandId', 'open') ORDER BY p.s)
        FROM parts p WHERE p."tenantId" = t."tenantId" AND p."weekday" = d.wd
      ), '[]'::jsonb)
    END AS j
  FROM tenants t
  CROSS JOIN generate_series(0, 6) AS d(wd)
  LEFT JOIN has_hours h ON h."tenantId" = t."tenantId"
),
week AS (SELECT "tenantId", jsonb_agg(j ORDER BY wd) AS w FROM day_json GROUP BY "tenantId")
INSERT INTO "business_schedules" ("id", "tenantId", "name", "timezone", "isDefault", "config", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, w."tenantId", 'Horário padrão', COALESCE(s."timezone", 'America/Sao_Paulo'), true,
  jsonb_build_object(
    'bands', jsonb_build_array(jsonb_build_object('id', 'open', 'name', 'Aberto', 'color', '#16a34a', 'open', true, 'behavior', 'normal', 'reply', 'message', 'items', '[]'::jsonb)),
    'closed', jsonb_build_object('behavior', 'notify_fallback', 'reply', 'message', 'items',
      CASE WHEN COALESCE(btrim(s."outsideHoursText"), '') = '' THEN '[]'::jsonb
      ELSE jsonb_build_array(jsonb_build_object('id', 'legacy', 'kind', 'text', 'text', s."outsideHoursText")) END),
    'week', w.w,
    'exceptions', '[]'::jsonb
  ),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM week w
LEFT JOIN "tenant_settings" s ON s."tenantId" = w."tenantId";

-- ---- remove o modelo antigo ----
ALTER TABLE "tenant_settings" DROP COLUMN "outsideHoursText";
DROP TABLE "business_hours";
