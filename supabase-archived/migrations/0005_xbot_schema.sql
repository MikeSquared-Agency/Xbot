-- 0005_xbot_schema.sql
-- Change embedding dimension from 1536 (AWS Bedrock) to 384 (local Xenova/all-MiniLM-L6-v2)
-- Add selector resilience columns to tools table

-- Change embedding dimension on configs table
ALTER TABLE "configs" DROP COLUMN "embedding";
ALTER TABLE "configs" ADD COLUMN "embedding" vector(384);

-- Recreate HNSW index for new dimension
DROP INDEX IF EXISTS "idx_configs_embedding";
CREATE INDEX "idx_configs_embedding" ON "configs" USING hnsw ("embedding" vector_cosine_ops);

-- Add selector resilience columns to tools table
ALTER TABLE "tools"
  ADD COLUMN "last_verified" timestamp with time zone,
  ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "fallback_selectors" jsonb;

CREATE INDEX "idx_tools_failure_count" ON "tools" ("failure_count") WHERE "failure_count" > 0;
