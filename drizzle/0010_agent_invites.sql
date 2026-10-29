ALTER TABLE "workspaces" ADD COLUMN "origin" text DEFAULT 'signup' NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_origin_check" CHECK ("origin" in ('signup', 'invite'));
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "claim_token_hash" text;
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "claimed_at" timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_claim_token_hash_unique" ON "workspaces" ("claim_token_hash") WHERE "claim_token_hash" is not null;
--> statement-breakpoint
CREATE TABLE "agent_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "label" text,
  "daily_cap" integer DEFAULT 50 NOT NULL,
  "approve_on_redeem" boolean DEFAULT false NOT NULL,
  "max_uses" integer DEFAULT 1 NOT NULL,
  "uses" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_by_user_id" uuid,
  "created_by_agent_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "agent_invites_daily_cap_check" CHECK ("daily_cap" >= 1 and "daily_cap" <= 10000),
  CONSTRAINT "agent_invites_max_uses_check" CHECK ("max_uses" >= 1 and "max_uses" <= 1000),
  CONSTRAINT "agent_invites_uses_check" CHECK ("uses" >= 0 and "uses" <= "max_uses"),
  CONSTRAINT "agent_invites_creator_check" CHECK ("created_by_user_id" is not null or "created_by_agent_id" is not null),
  CONSTRAINT "agent_invites_approve_check" CHECK (not "approve_on_redeem" or "created_by_user_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "agent_invites" ADD CONSTRAINT "agent_invites_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_invites" ADD CONSTRAINT "agent_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_invites" ADD CONSTRAINT "agent_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_invites" ADD CONSTRAINT "agent_invites_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_invites_token_hash_unique" ON "agent_invites" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "agent_invites_agent_idx" ON "agent_invites" USING btree ("agent_id","created_at");
--> statement-breakpoint
CREATE TABLE "agent_invite_offers" (
  "invite_id" uuid NOT NULL,
  "offer_id" uuid NOT NULL,
  CONSTRAINT "agent_invite_offers_invite_id_offer_id_pk" PRIMARY KEY("invite_id","offer_id")
);
--> statement-breakpoint
ALTER TABLE "agent_invite_offers" ADD CONSTRAINT "agent_invite_offers_invite_id_agent_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."agent_invites"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_invite_offers" ADD CONSTRAINT "agent_invite_offers_offer_id_agent_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."agent_offers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD COLUMN "invite_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD COLUMN "label" text;
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_invite_id_agent_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."agent_invites"("id") ON DELETE set null ON UPDATE no action;
