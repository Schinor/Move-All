-- Subprojeto A (catálogo e card): SOMENTE ADITIVO.
CREATE TABLE "catalog_families" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name_pt" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_families_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_families_key_key" ON "catalog_families"("key");

CREATE TABLE "catalog_types" (
  "id" UUID NOT NULL,
  "family_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name_pt" TEXT NOT NULL,
  "description_en" TEXT NOT NULL,
  "ncm" TEXT,
  "card_key_attrs" JSONB NOT NULL DEFAULT '[]',
  "comparison_attrs" JSONB NOT NULL DEFAULT '[]',
  "variation_attrs" JSONB NOT NULL DEFAULT '[]',
  "source" TEXT NOT NULL DEFAULT 'seed',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_types_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalog_types_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "catalog_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "catalog_types_key_key" ON "catalog_types"("key");

CREATE TABLE "listing_fichas" (
  "id" UUID NOT NULL,
  "marketplace" TEXT NOT NULL,
  "external_product_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "input_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "type_key" TEXT,
  "suggested_type" TEXT,
  "in_scope" BOOLEAN,
  "is_accessory_or_part" BOOLEAN,
  "is_kit_or_bundle" BOOLEAN,
  "has_variations" BOOLEAN,
  "card_key_values" JSONB NOT NULL DEFAULT '{}',
  "new_differential" TEXT,
  "missing_key_attrs" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "comparison_values" JSONB NOT NULL DEFAULT '{}',
  "variation_values" JSONB NOT NULL DEFAULT '{}',
  "specs" JSONB NOT NULL DEFAULT '{}',
  "brand" TEXT,
  "model" TEXT,
  "confidence" DECIMAL(4,3),
  "llm_model" TEXT,
  "prompt_version" TEXT,
  "copied_from_ficha_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "listing_fichas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "listing_fichas_marketplace_external_product_id_key" ON "listing_fichas"("marketplace", "external_product_id");
CREATE INDEX "listing_fichas_status_priority_created_at_idx" ON "listing_fichas"("status", "priority" DESC, "created_at");
CREATE INDEX "listing_fichas_input_hash_idx" ON "listing_fichas"("input_hash");

CREATE TABLE "catalog_review_items" (
  "id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "marketplace" TEXT,
  "external_product_id" TEXT,
  "suggested_cluster_id" UUID,
  "suggested_type_key" TEXT,
  "suggested_type_aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "listing_count" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "resolution" TEXT,
  "resolved_by" UUID,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_review_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalog_review_items_suggested_cluster_id_fkey" FOREIGN KEY ("suggested_cluster_id") REFERENCES "product_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "catalog_review_items_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "catalog_review_items_kind_status_created_at_idx" ON "catalog_review_items"("kind", "status", "created_at");
CREATE INDEX "catalog_review_items_marketplace_external_product_id_idx" ON "catalog_review_items"("marketplace", "external_product_id");

CREATE TABLE "catalog_decisions" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "review_item_id" UUID,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "undone_by_decision_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalog_decisions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "catalog_decisions_created_at_idx" ON "catalog_decisions"("created_at");

ALTER TABLE "product_clusters"
  ADD COLUMN "type_id" UUID,
  ADD COLUMN "card_key" TEXT,
  ADD COLUMN "card_key_values" JSONB,
  ADD COLUMN "card_status" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "name_locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "merged_into_id" UUID;
ALTER TABLE "product_clusters"
  ADD CONSTRAINT "product_clusters_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "catalog_types"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "product_clusters_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "product_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "idx_clusters_card_key" ON "product_clusters"("card_key");
CREATE INDEX "idx_clusters_type_status" ON "product_clusters"("type_id", "card_status");

ALTER TABLE "product_cluster_items" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE "product_listing_snapshots" ADD COLUMN "analytics_excluded" BOOLEAN NOT NULL DEFAULT false;
