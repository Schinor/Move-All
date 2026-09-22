-- Subprojeto D: termos em alta do radar para o ADMIN aprovar e buscar anúncios.
CREATE TABLE IF NOT EXISTS discovery_terms (
  id uuid PRIMARY KEY,
  type_key text NOT NULL,
  geo text NOT NULL,
  term text NOT NULL,
  term_norm text NOT NULL,
  rising_value integer NOT NULL DEFAULT 0,
  rising_label text NOT NULL DEFAULT '',
  breakout boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'new',
  first_seen_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by uuid,
  decided_at timestamp(3),
  searched_at timestamp(3),
  search_job_id uuid,
  new_listings integer,
  search_error text
);
CREATE UNIQUE INDEX IF NOT EXISTS discovery_terms_geo_term_norm_key ON discovery_terms (geo, term_norm);
CREATE INDEX IF NOT EXISTS discovery_terms_status_idx ON discovery_terms (status);

-- Subprojeto D: motivo do nível de acompanhamento (top50, descoberta, radar, demais, watchlist).
ALTER TABLE tracked_listings ADD COLUMN IF NOT EXISTS tier_reason text;
ALTER TABLE tracked_listings ADD COLUMN IF NOT EXISTS tier_updated_at timestamp(3);
