-- Score oficial Monte Carlo (Fase 2, F2.1). Append-only por cálculo; o
-- vigente por cluster é o de maior `computed_at`. Os campos legados
-- `risk_level`/`financial_score`/`simulated_at` de `product_clusters` ficam
-- como deprecated até F2.7.

CREATE TABLE IF NOT EXISTS "product_scores" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_cluster_id" UUID NOT NULL,
  -- Nulo quando não há dados para calcular: sem número, só data_confidence.
  "score" INTEGER,
  "decision" TEXT NOT NULL,
  "p_vpl_positivo" DOUBLE PRECISION,
  "cvar5" DOUBLE PRECISION,
  "vpl_mediano" DOUBLE PRECISION,
  "premises" JSONB NOT NULL,
  "premises_hash" TEXT NOT NULL,
  "data_version" TEXT NOT NULL,
  "data_confidence" TEXT NOT NULL,
  "scenario_count" INTEGER NOT NULL,
  "computed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "product_scores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_scores_product_cluster_id_fkey"
    FOREIGN KEY ("product_cluster_id") REFERENCES "product_clusters"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "product_scores_product_cluster_id_computed_at_idx"
  ON "product_scores"("product_cluster_id", "computed_at");
