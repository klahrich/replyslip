-- Site assistant demo (story 0b). Additive only: new tables, no change to existing tables, so no NOT VALID
-- checks or CONCURRENTLY indexes are needed (they apply to existing, populated tables).
-- Composite foreign keys (child_id, business_id) -> parent(id, business_id) keep a row from pointing at another
-- business's link, conversation or suggested answer.
-- ON DELETE SET NULL (column list) needs Postgres 15 or later.
CREATE TABLE "site_businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"source_url" text NOT NULL,
	"scraped_at" timestamp with time zone,
	"context_md" text NOT NULL,
	"suggested_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"desktop_shot" bytea,
	"desktop_shot_type" text,
	"mobile_shot" bytea,
	"mobile_shot_type" text,
	"language" text DEFAULT 'en' NOT NULL,
	"tile_color" text,
	"visitor_daily_message_cap" integer DEFAULT 20 NOT NULL,
	"daily_message_cap" integer DEFAULT 30 NOT NULL,
	"daily_cost_cap_micro_usd" bigint DEFAULT 250000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_businesses_slug_check" CHECK ("site_businesses"."slug" ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
	CONSTRAINT "site_businesses_display_name_check" CHECK (char_length("site_businesses"."display_name") between 1 and 120),
	CONSTRAINT "site_businesses_source_url_check" CHECK ("site_businesses"."source_url" ~ '^https?://'),
	CONSTRAINT "site_businesses_context_check" CHECK (char_length("site_businesses"."context_md") <= 200000),
	CONSTRAINT "site_businesses_suggested_check" CHECK (jsonb_typeof("site_businesses"."suggested_questions") = 'array'),
	CONSTRAINT "site_businesses_desktop_shot_check" CHECK (("site_businesses"."desktop_shot" is null) = ("site_businesses"."desktop_shot_type" is null) and ("site_businesses"."desktop_shot_type" is null or "site_businesses"."desktop_shot_type" in ('image/png', 'image/jpeg', 'image/webp'))),
	CONSTRAINT "site_businesses_mobile_shot_check" CHECK (("site_businesses"."mobile_shot" is null) = ("site_businesses"."mobile_shot_type" is null) and ("site_businesses"."mobile_shot_type" is null or "site_businesses"."mobile_shot_type" in ('image/png', 'image/jpeg', 'image/webp'))),
	CONSTRAINT "site_businesses_language_check" CHECK ("site_businesses"."language" in ('en', 'fr')),
	CONSTRAINT "site_businesses_tile_color_check" CHECK ("site_businesses"."tile_color" is null or "site_businesses"."tile_color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "site_businesses_caps_check" CHECK ("site_businesses"."visitor_daily_message_cap" >= 0 and "site_businesses"."daily_message_cap" >= 0 and "site_businesses"."daily_cost_cap_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "site_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"demo_link_id" uuid NOT NULL,
	"visitor_token_hash" text NOT NULL,
	"mode" text DEFAULT 'demo' NOT NULL,
	"language" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_conversations_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "site_conversations_mode_check" CHECK ("site_conversations"."mode" in ('demo')),
	CONSTRAINT "site_conversations_language_check" CHECK ("site_conversations"."language" is null or "site_conversations"."language" in ('en', 'fr', 'other'))
);
--> statement-breakpoint
CREATE TABLE "site_demo_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_demo_links_id_business_unique" UNIQUE("id","business_id")
);
--> statement-breakpoint
CREATE TABLE "site_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"body" text NOT NULL,
	"status" text,
	"topic" text,
	"language" text,
	"decided_by" text,
	"sources_kept" jsonb,
	"sources_dropped" jsonb,
	"owner_question" text,
	"raw_output" jsonb,
	"suggested_answer_id" uuid,
	"client_message_id" uuid,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_micro_usd" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_messages_role_check" CHECK ("site_messages"."role" in ('visitor', 'assistant')),
	CONSTRAINT "site_messages_body_check" CHECK (char_length("site_messages"."body") <= 4000),
	CONSTRAINT "site_messages_status_check" CHECK ("site_messages"."status" is null or "site_messages"."status" in ('answered', 'needs_owner', 'off_topic', 'capped')),
	CONSTRAINT "site_messages_language_check" CHECK ("site_messages"."language" is null or "site_messages"."language" in ('en', 'fr', 'other'))
);
--> statement-breakpoint
CREATE TABLE "site_suggested_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"status" text NOT NULL,
	"topic" text,
	"language" text NOT NULL,
	"decided_by" text NOT NULL,
	"sources_kept" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_output" jsonb,
	"model" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	CONSTRAINT "site_suggested_answers_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "site_suggested_answers_question_check" CHECK (char_length("site_suggested_answers"."question") between 1 and 1000),
	CONSTRAINT "site_suggested_answers_status_check" CHECK ("site_suggested_answers"."status" in ('answered', 'needs_owner', 'off_topic', 'capped')),
	CONSTRAINT "site_suggested_answers_language_check" CHECK ("site_suggested_answers"."language" in ('en', 'fr', 'other'))
);
--> statement-breakpoint
CREATE TABLE "site_usage_daily" (
	"business_id" uuid NOT NULL,
	"day" date NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"llm_calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"reserved_micro_usd" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "site_usage_daily_business_id_day_pk" PRIMARY KEY("business_id","day"),
	CONSTRAINT "site_usage_daily_nonneg_check" CHECK ("site_usage_daily"."messages" >= 0 and "site_usage_daily"."reserved_micro_usd" >= 0 and "site_usage_daily"."cost_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "site_usage_global_daily" (
	"day" date PRIMARY KEY NOT NULL,
	"llm_calls" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"reserved_micro_usd" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "site_usage_global_daily_nonneg_check" CHECK ("site_usage_global_daily"."reserved_micro_usd" >= 0 and "site_usage_global_daily"."cost_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "site_visitor_usage_daily" (
	"conversation_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"day" date NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "site_visitor_usage_daily_conversation_id_day_pk" PRIMARY KEY("conversation_id","day")
);
--> statement-breakpoint
CREATE TABLE "site_message_requests" (
	"demo_link_id" uuid NOT NULL,
	"client_message_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"visitor_message_id" uuid,
	"assistant_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_message_requests_demo_link_id_client_message_id_pk" PRIMARY KEY("demo_link_id","client_message_id"),
	CONSTRAINT "site_message_requests_state_check" CHECK ("site_message_requests"."state" in ('pending', 'done', 'failed')),
	CONSTRAINT "site_message_requests_done_check" CHECK ("site_message_requests"."state" <> 'done' or ("site_message_requests"."visitor_message_id" is not null and "site_message_requests"."assistant_message_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "site_ip_usage_daily" (
	"key_hash" text NOT NULL,
	"day" date NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "site_ip_usage_daily_key_hash_day_pk" PRIMARY KEY("key_hash","day"),
	CONSTRAINT "site_ip_usage_daily_nonneg_check" CHECK ("site_ip_usage_daily"."messages" >= 0)
);
--> statement-breakpoint
ALTER TABLE "site_message_requests" ADD CONSTRAINT "site_message_requests_demo_link_fk" FOREIGN KEY ("demo_link_id","business_id") REFERENCES "public"."site_demo_links"("id","business_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "site_message_requests" ADD CONSTRAINT "site_message_requests_conversation_fk" FOREIGN KEY ("conversation_id","business_id") REFERENCES "public"."site_conversations"("id","business_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "site_message_requests_conversation_idx" ON "site_message_requests" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX "site_ip_usage_daily_day_idx" ON "site_ip_usage_daily" USING btree ("day");
--> statement-breakpoint
ALTER TABLE "site_conversations" ADD CONSTRAINT "site_conversations_demo_link_fk" FOREIGN KEY ("demo_link_id","business_id") REFERENCES "public"."site_demo_links"("id","business_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "site_demo_links" ADD CONSTRAINT "site_demo_links_business_id_site_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."site_businesses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "site_messages" ADD CONSTRAINT "site_messages_conversation_fk" FOREIGN KEY ("conversation_id","business_id") REFERENCES "public"."site_conversations"("id","business_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "site_messages" ADD CONSTRAINT "site_messages_suggested_answer_fk" FOREIGN KEY ("suggested_answer_id","business_id") REFERENCES "public"."site_suggested_answers"("id","business_id") ON DELETE SET NULL ("suggested_answer_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "site_suggested_answers" ADD CONSTRAINT "site_suggested_answers_business_id_site_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."site_businesses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "site_usage_daily" ADD CONSTRAINT "site_usage_daily_business_id_site_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."site_businesses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "site_visitor_usage_daily" ADD CONSTRAINT "site_visitor_usage_conversation_fk" FOREIGN KEY ("conversation_id","business_id") REFERENCES "public"."site_conversations"("id","business_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "site_businesses_slug_unique" ON "site_businesses" USING btree ("slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "site_conversations_visitor_unique" ON "site_conversations" USING btree ("demo_link_id","visitor_token_hash");
--> statement-breakpoint
CREATE INDEX "site_conversations_last_message_idx" ON "site_conversations" USING btree ("last_message_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "site_demo_links_token_hash_unique" ON "site_demo_links" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "site_demo_links_business_idx" ON "site_demo_links" USING btree ("business_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "site_messages_client_unique" ON "site_messages" USING btree ("conversation_id","role","client_message_id") WHERE "site_messages"."client_message_id" is not null;
--> statement-breakpoint
CREATE INDEX "site_messages_conversation_idx" ON "site_messages" USING btree ("conversation_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "site_suggested_answers_question_unique" ON "site_suggested_answers" USING btree ("business_id","question");
