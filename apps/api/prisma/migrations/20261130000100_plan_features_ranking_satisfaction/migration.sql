-- Ranking/metas e pesquisa de satisfação viram recursos de plano (`consultant_ranking`, `satisfaction_surveys`).
-- Entram em TODOS os planos existentes para ninguém perder o que já usa (o ranking existia para todos);
-- o dono tira em Planos de quem não deve ter. Overrides com lista própria de recursos recebem também.
UPDATE "plans"
SET "limits" = jsonb_set("limits"::jsonb, '{features}',
  (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(coalesce("limits"::jsonb->'features', '[]'::jsonb) || '["consultant_ranking","satisfaction_surveys"]'::jsonb) x));

UPDATE "plan_overrides"
SET "limits" = jsonb_set("limits"::jsonb, '{features}',
  (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text("limits"::jsonb->'features' || '["consultant_ranking","satisfaction_surveys"]'::jsonb) x))
WHERE jsonb_typeof("limits"::jsonb->'features') = 'array';
