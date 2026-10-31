-- Site demo (story 0b), second step: link-wide client_message_id claims and per-IP daily counts.
-- Split out of 0015 because 0015 had already been applied to shared databases. Written to be safe to re-run
-- on a database that got these tables from an interim 0015 (IF NOT EXISTS, constraints added only when missing).
-- Both tables are new and empty, so plain CREATE INDEX is instant; CONCURRENTLY can't run inside the
-- migrator's transaction anyway.
CREATE TABLE IF NOT EXISTS "site_message_requests" (
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
	CONSTRAINT "site_message_requests_demo_link_id_client_message_id_pk" PRIMARY KEY("demo_link_id","client_message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_ip_usage_daily" (
	"key_hash" text NOT NULL,
	"day" date NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "site_ip_usage_daily_key_hash_day_pk" PRIMARY KEY("key_hash","day")
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_message_requests_state_check' AND conrelid = 'public.site_message_requests'::regclass) THEN
		ALTER TABLE "site_message_requests" ADD CONSTRAINT "site_message_requests_state_check" CHECK ("state" in ('pending', 'done', 'failed')) NOT VALID;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "site_message_requests" VALIDATE CONSTRAINT "site_message_requests_state_check";
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_message_requests_done_check' AND conrelid = 'public.site_message_requests'::regclass) THEN
		ALTER TABLE "site_message_requests" ADD CONSTRAINT "site_message_requests_done_check" CHECK ("state" <> 'done' or ("visitor_message_id" is not null and "assistant_message_id" is not null)) NOT VALID;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "site_message_requests" VALIDATE CONSTRAINT "site_message_requests_done_check";
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_ip_usage_daily_nonneg_check' AND conrelid = 'public.site_ip_usage_daily'::regclass) THEN
		ALTER TABLE "site_ip_usage_daily" ADD CONSTRAINT "site_ip_usage_daily_nonneg_check" CHECK ("messages" >= 0) NOT VALID;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "site_ip_usage_daily" VALIDATE CONSTRAINT "site_ip_usage_daily_nonneg_check";
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_message_requests_demo_link_fk' AND conrelid = 'public.site_message_requests'::regclass) THEN
		ALTER TABLE "site_message_requests" ADD CONSTRAINT "site_message_requests_demo_link_fk" FOREIGN KEY ("demo_link_id","business_id") REFERENCES "public"."site_demo_links"("id","business_id") ON DELETE cascade ON UPDATE no action NOT VALID;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "site_message_requests" VALIDATE CONSTRAINT "site_message_requests_demo_link_fk";
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_message_requests_conversation_fk' AND conrelid = 'public.site_message_requests'::regclass) THEN
		ALTER TABLE "site_message_requests" ADD CONSTRAINT "site_message_requests_conversation_fk" FOREIGN KEY ("conversation_id","business_id") REFERENCES "public"."site_conversations"("id","business_id") ON DELETE cascade ON UPDATE no action NOT VALID;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "site_message_requests" VALIDATE CONSTRAINT "site_message_requests_conversation_fk";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_message_requests_conversation_idx" ON "site_message_requests" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_ip_usage_daily_day_idx" ON "site_ip_usage_daily" USING btree ("day");
