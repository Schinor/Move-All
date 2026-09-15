-- Avaliações: distribuição de estrelas + amostras de texto (Fase A, A5).
-- Não aplicar sem revisão do Raul (regra do plano: quem aplica é o Raul).

-- Distribuição 1–5 observada na página do anúncio (null se a fonte não exibe).
ALTER TABLE "listing_observations"
  ADD COLUMN IF NOT EXISTS "rating_distribution" JSONB;

-- Contagem de reviews na última amostra de textos do anúncio.
ALTER TABLE "tracked_listings"
  ADD COLUMN IF NOT EXISTS "reviews_count_at_sample" INTEGER;

-- Amostras de texto para o resumo por faixa (B5). Sem nome de quem avaliou.
CREATE TABLE IF NOT EXISTS "review_samples" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "listing_id" UUID NOT NULL,
  "collected_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "stars" INTEGER,
  "text" TEXT NOT NULL,
  "source_review_id" TEXT,
  "language" VARCHAR(16),
  CONSTRAINT "review_samples_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "review_samples_listing_id_fkey"
    FOREIGN KEY ("listing_id") REFERENCES "tracked_listings"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "review_samples_listing_id_collected_at_idx"
  ON "review_samples"("listing_id", "collected_at");
