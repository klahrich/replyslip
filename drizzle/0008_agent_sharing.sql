ALTER TABLE "workspaces" ADD COLUMN "handle" text;
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_handle_check" CHECK ("handle" is null or "handle" ~ '^[a-z][a-z0-9-]{1,31}$');
--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_handle_unique" ON "workspaces" ("handle") WHERE "handle" is not null;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "agent_offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "result_schema" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "agent_offers_name_check" CHECK ("name" ~ '^[a-z][a-z0-9_-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "agent_offers" ADD CONSTRAINT "agent_offers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_offers_agent_name_unique" ON "agent_offers" USING btree ("agent_id","name");
--> statement-breakpoint
CREATE TABLE "agent_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "guest_workspace_id" uuid NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "daily_cap" integer DEFAULT 50 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "agent_shares_status_check" CHECK ("status" in ('pending', 'approved', 'revoked')),
  CONSTRAINT "agent_shares_daily_cap_check" CHECK ("daily_cap" >= 1 and "daily_cap" <= 10000)
);
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_guest_workspace_id_workspaces_id_fk" FOREIGN KEY ("guest_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_shares_agent_guest_unique" ON "agent_shares" USING btree ("agent_id","guest_workspace_id");
--> statement-breakpoint
CREATE TABLE "agent_share_offers" (
  "share_id" uuid NOT NULL,
  "offer_id" uuid NOT NULL,
  CONSTRAINT "agent_share_offers_share_id_offer_id_pk" PRIMARY KEY("share_id","offer_id")
);
--> statement-breakpoint
ALTER TABLE "agent_share_offers" ADD CONSTRAINT "agent_share_offers_share_id_agent_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."agent_shares"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_share_offers" ADD CONSTRAINT "agent_share_offers_offer_id_agent_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."agent_offers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "from_workspace_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "offer_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_from_workspace_id_workspaces_id_fk" FOREIGN KEY ("from_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_offer_id_agent_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."agent_offers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tasks_from_workspace_idx" ON "tasks" USING btree ("from_workspace_id","created_at");
