-- Public wake URLs (lib/wake-urls.ts, docs/api.md "Wake URL for external agents"). Additive: one new table and one
-- new index on wakes. Roll back by dropping wake_urls and wakes_agent_created_idx.
-- token_hash holds sha256 hex of the URL token, the same as agent_keys and watcher_keys. The token itself is never stored.
CREATE TABLE "wake_urls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "wake_urls" ADD CONSTRAINT "wake_urls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wake_urls" ADD CONSTRAINT "wake_urls_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "wake_urls_token_hash_unique" ON "wake_urls" USING btree ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "wake_urls_one_active_per_agent" ON "wake_urls" USING btree ("agent_id") WHERE "wake_urls"."revoked_at" is null;
--> statement-breakpoint
CREATE INDEX "wakes_agent_created_idx" ON "wakes" USING btree ("agent_id","created_at");
