-- Contexto da observação de demanda (F1.6): identificam a requisição que
-- torna execuções comparáveis, sem reescrever o histórico.

ALTER TABLE "demand_signals"
  ADD COLUMN IF NOT EXISTS "request_id" TEXT,
  ADD COLUMN IF NOT EXISTS "timeframe" TEXT,
  ADD COLUMN IF NOT EXISTS "anchor_keyword" TEXT;
