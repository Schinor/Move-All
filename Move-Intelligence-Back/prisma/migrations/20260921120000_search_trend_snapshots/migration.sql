-- Subprojeto C: uma linha por termo/país/coleta do Google Trends (índice relativo à própria coleta).
CREATE TABLE IF NOT EXISTS search_trend_snapshots (
  id uuid PRIMARY KEY,
  type_key text NOT NULL,
  term text NOT NULL,
  geo text NOT NULL,
  timeframe text NOT NULL,
  status text NOT NULL,
  error text,
  points jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_value integer,
  growth_4w double precision,
  growth_12w double precision,
  related_top jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_rising jsonb NOT NULL DEFAULT '[]'::jsonb,
  captured_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS search_trend_snapshots_type_geo_captured_idx
  ON search_trend_snapshots (type_key, geo, captured_at);
