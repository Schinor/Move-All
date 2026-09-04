-- Search indexes for Copilot ILIKE on product_clusters (pg_trgm is created in init-extensions.sql).
CREATE INDEX IF NOT EXISTS idx_clusters_canonical_trgm
  ON product_clusters USING GIN (canonical_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clusters_category
  ON product_clusters (category);

-- Make listing snapshots idempotent for the fitness seed (upsert on natural key).
DROP INDEX IF EXISTS product_listing_snapshots_marketplace_external_product_id_c_idx;

CREATE UNIQUE INDEX IF NOT EXISTS pls_marketplace_extid_collected_at_key
  ON product_listing_snapshots (marketplace, external_product_id, collected_at);
