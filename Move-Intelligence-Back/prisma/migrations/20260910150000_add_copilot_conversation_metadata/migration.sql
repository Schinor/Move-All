ALTER TABLE "ai_conversations"
  ADD COLUMN IF NOT EXISTS "client_id" TEXT,
  ADD COLUMN IF NOT EXISTS "is_pinned" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "ai_conversations_client_id_updated_at_idx"
  ON "ai_conversations"("client_id", "updated_at");
