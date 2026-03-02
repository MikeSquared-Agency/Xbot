CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "configs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "domain" text NOT NULL,
    "url_pattern" text NOT NULL,
    "title" text NOT NULL,
    "description" text NOT NULL,
    "tags" jsonb,
    "embedding" vector(1536),
    "visit_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "configs_title_length" CHECK (char_length("configs"."title") <= 200),
    CONSTRAINT "configs_description_length" CHECK (char_length("configs"."description") <= 5000)
);

ALTER TABLE "configs" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "tools" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "config_id" uuid NOT NULL,
    "name" text NOT NULL,
    "description" text NOT NULL,
    "input_schema" jsonb NOT NULL,
    "execution" jsonb,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "tools" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "tools" ADD CONSTRAINT "tools_config_id_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."configs"("id") ON DELETE cascade ON UPDATE no action;

-- RLS policies: allow all operations for authenticated and anonymous roles
-- (self-hosted setup; tighten for multi-tenant use)
CREATE POLICY "allow_all_configs" ON "configs" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_tools"   ON "tools"   FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX "idx_configs_domain" ON "configs" USING btree ("domain");
CREATE UNIQUE INDEX "configs_domain_url_unique" ON "configs" USING btree ("domain","url_pattern");
CREATE INDEX "idx_configs_embedding" ON "configs" USING hnsw ("embedding" vector_cosine_ops);
CREATE UNIQUE INDEX "uq_tools_config_name" ON "tools" USING btree ("config_id","name");
CREATE INDEX "idx_tools_config_id" ON "tools" USING btree ("config_id");
