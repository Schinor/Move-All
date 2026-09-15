-- Fornecedores B2B de alto volume (Fase A, A6). Não aplicar sem revisão
-- do Raul (regra do plano: quem aplica é o Raul).

CREATE TABLE IF NOT EXISTS "suppliers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source" TEXT NOT NULL,
  "native_supplier_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "years_on_platform" INTEGER,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "country" TEXT,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "suppliers_source_native_supplier_id_key"
    UNIQUE ("source", "native_supplier_id")
);

-- Vínculo do anúncio com o fornecedor de alto volume. Null enquanto não
-- houver identificação confiável — canal de venda nunca é fornecedor.
ALTER TABLE "tracked_listings"
  ADD COLUMN IF NOT EXISTS "supplier_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tracked_listings_supplier_id_fkey'
  ) THEN
    ALTER TABLE "tracked_listings"
      ADD CONSTRAINT "tracked_listings_supplier_id_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
