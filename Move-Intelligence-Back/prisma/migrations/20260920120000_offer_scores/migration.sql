-- Subprojeto B: score por oferta (anúncio de fornecedor) dentro do card.
CREATE TABLE IF NOT EXISTS offer_scores (
  id uuid PRIMARY KEY,
  product_cluster_id uuid NOT NULL REFERENCES product_clusters(id) ON DELETE CASCADE,
  marketplace text NOT NULL,
  external_product_id text NOT NULL,
  score integer,
  state text NOT NULL,
  unit_cost_usd numeric(14,4),
  moq integer NOT NULL,
  capital_primeiro_pedido double precision,
  p_vpl_positivo double precision,
  vpl_mediano double precision,
  cvar5 double precision,
  premises jsonb NOT NULL DEFAULT '{}'::jsonb,
  premises_hash text NOT NULL DEFAULT '',
  data_version text NOT NULL,
  scenario_count integer NOT NULL DEFAULT 0,
  computed_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS offer_scores_cluster_offer_computed_idx
  ON offer_scores (product_cluster_id, marketplace, external_product_id, computed_at);
