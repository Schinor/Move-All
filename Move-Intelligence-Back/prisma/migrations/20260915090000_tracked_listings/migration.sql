-- Tabelas do loop de acompanhamento (Fase 1): descoberta + acompanhamento.
-- Ver RELATORIO_ANALISE_DADOS_E_SCORES.md seção 2.2 e PLANO_EXECUCAO_CORRECOES.md F1.1.
-- `listing_observations` é APPEND-ONLY: nenhum código faz UPDATE nela.

CREATE TABLE IF NOT EXISTS "tracked_listings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source" TEXT NOT NULL,
  "native_id" TEXT NOT NULL,
  "canonical_url" TEXT NOT NULL,
  "product_id" UUID,
  "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
  "tier" INTEGER NOT NULL DEFAULT 3,
  "discovered_by_term" TEXT,
  "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_seen_at" TIMESTAMPTZ,
  "last_success_at" TIMESTAMPTZ,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "next_due_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "tracked_listings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tracked_listings_source_native_id_key"
  ON "tracked_listings"("source", "native_id");

CREATE INDEX IF NOT EXISTS "tracked_listings_status_next_due_at_idx"
  ON "tracked_listings"("status", "next_due_at");

CREATE TABLE IF NOT EXISTS "listing_observations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "listing_id" UUID NOT NULL,
  "observed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "price" DECIMAL(14, 4),
  "currency" TEXT,
  "rating" DECIMAL(5, 2),
  "reviews_count" INTEGER,
  "sold_count_raw" TEXT,
  "sold_count_lower" INTEGER,
  "best_seller_rank" INTEGER,
  "in_stock" BOOLEAN,
  "scrape_status" TEXT NOT NULL,
  "parser_version" TEXT NOT NULL,
  "content_hash" TEXT,
  "is_synthetic" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "listing_observations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "listing_observations_listing_id_fkey"
    FOREIGN KEY ("listing_id") REFERENCES "tracked_listings"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "listing_observations_listing_id_observed_at_idx"
  ON "listing_observations"("listing_id", "observed_at");
