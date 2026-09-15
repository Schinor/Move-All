-- Adiciona a flag is_synthetic em products e product_listing_snapshots para
-- distinguir dados gerados pelo pipeline sintético (historical-collection /
-- seed-6months, supplier "Move Fitness Partner%") de coleta real.
-- Idempotente: pode ser reaplicada sem efeito colateral.
-- Ver RELATORIO_ANALISE_DADOS_E_SCORES.md seção 2.1 A5 e 5 "Fase 0".

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "is_synthetic" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "products_is_synthetic_idx"
  ON "products"("is_synthetic");

ALTER TABLE "product_listing_snapshots"
  ADD COLUMN IF NOT EXISTS "is_synthetic" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "product_listing_snapshots_is_synthetic_idx"
  ON "product_listing_snapshots"("is_synthetic");

-- Backfill: marca como sintético tudo que já veio dos geradores
-- historical-collection (supplier "Move Fitness Partner*", record_id "prod_*")
-- e seed-6months (source_specific.weekly_index, external "ext_*", imagens do seed).
-- O UPDATE de products vem antes por causa da subconsulta em snapshots.
UPDATE "products"
SET "is_synthetic" = true
WHERE "is_synthetic" = false
  AND (
    "supplier" LIKE 'Move Fitness Partner%'
    OR "record_id" LIKE 'prod\_%' ESCAPE '\'
    OR "source_specific" ? 'weekly_index'
  );

-- Backfill dos snapshots: pelo seller_name gravado diretamente pelo pipeline
-- sintético, pelos padrões dos dois geradores, ou por referência ao produto
-- sintético via raw_product_id.
UPDATE "product_listing_snapshots"
SET "is_synthetic" = true
WHERE "is_synthetic" = false
  AND (
    "seller_name" LIKE 'Move Fitness Partner%'
    OR "external_product_id" LIKE 'prod\_%' ESCAPE '\'
    OR "external_product_id" LIKE 'ext\_%' ESCAPE '\'
    OR "image_url" LIKE 'https://images.move-intelligence.com/%'
    OR "raw_product_id" IN (
      SELECT "id" FROM "products" WHERE "is_synthetic" = true
    )
  );
