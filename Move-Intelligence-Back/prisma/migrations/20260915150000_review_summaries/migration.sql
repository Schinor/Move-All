-- B5 (decisão 10): resumo de avaliações por faixa. Histórico por
-- cluster/faixa; exibe o último. NÃO aplicar sem aprovação do Raul.

CREATE TABLE IF NOT EXISTS "review_summaries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_cluster_id" UUID NOT NULL,
  "band" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "top_reasons" JSONB NOT NULL,
  "sample_size" INTEGER NOT NULL,
  "reviews_count_at" INTEGER,
  "model" TEXT,
  "prompt_version" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "review_summaries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "review_summaries_product_cluster_id_fkey"
    FOREIGN KEY ("product_cluster_id") REFERENCES "product_clusters"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "review_summaries_product_cluster_id_band_created_at_idx"
  ON "review_summaries"("product_cluster_id", "band", "created_at");
