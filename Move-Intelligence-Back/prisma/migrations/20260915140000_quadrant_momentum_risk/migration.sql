-- B3 (decisões 2-3): ação por quadrante + momentum + faixa no ProductScore.
-- Decision fica como histórico até limpeza futura (backlog). NÃO aplicar sem
-- aprovação do Raul (regra 0.2 do plano).

ALTER TABLE "product_scores" ADD COLUMN IF NOT EXISTS "action" TEXT;
ALTER TABLE "product_scores" ADD COLUMN IF NOT EXISTS "momentum_direction" TEXT;
ALTER TABLE "product_scores" ADD COLUMN IF NOT EXISTS "momentum_growth_pct" DOUBLE PRECISION;
ALTER TABLE "product_scores" ADD COLUMN IF NOT EXISTS "momentum_confidence" TEXT;
ALTER TABLE "product_scores" ADD COLUMN IF NOT EXISTS "score_band" TEXT;
-- B4 (decisão 4): explicação do risco.
ALTER TABLE "product_scores" ADD COLUMN IF NOT EXISTS "risk_explanation" TEXT;
ALTER TABLE "product_scores" ADD COLUMN IF NOT EXISTS "risk_drivers" JSONB;
