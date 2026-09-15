-- C4 (decisão 14): busca aproximada no Postgres (pg_trgm) em nome,
-- categoria e fornecedor. NÃO aplicar sem aprovação do Raul.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Categoria dos clusters (já existe btree; adiciona trigram para similarity).
CREATE INDEX IF NOT EXISTS "idx_clusters_category_trgm"
  ON "product_clusters" USING gin ("category" gin_trgm_ops);

-- Nome do fornecedor B2B (A6/C5).
CREATE INDEX IF NOT EXISTS "idx_suppliers_name_trgm"
  ON "suppliers" USING gin ("name" gin_trgm_ops);
