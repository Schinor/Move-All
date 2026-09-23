-- Plano de coleta real e desempenho: resultado pré-calculado da consulta de cards (loadClusterRollups).
CREATE TABLE IF NOT EXISTS card_rollups (
  include_synthetic boolean NOT NULL,
  product_cluster_id uuid NOT NULL,
  category text,
  sort_order integer NOT NULL,
  row jsonb NOT NULL,
  PRIMARY KEY (include_synthetic, product_cluster_id)
);
CREATE INDEX IF NOT EXISTS card_rollups_order_idx ON card_rollups (include_synthetic, sort_order);
CREATE TABLE IF NOT EXISTS card_rollup_state (
  include_synthetic boolean PRIMARY KEY,
  computed_at timestamp(3) NOT NULL,
  stale boolean NOT NULL DEFAULT false
);
