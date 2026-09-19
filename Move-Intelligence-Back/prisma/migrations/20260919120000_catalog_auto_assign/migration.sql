-- Permite registrar decisões automáticas sem usuário executor.
-- actor_user_id NULL identifica uma decisão feita pelo sistema.
ALTER TABLE "catalog_decisions"
  ALTER COLUMN "actor_user_id" DROP NOT NULL;
