ALTER TABLE "workspaces" ADD COLUMN "claim_expires_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "role" text DEFAULT 'agent' NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_role_check" CHECK ("role" in ('agent', 'customer_sender'));
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "customer_daily_cap" integer DEFAULT 300 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_customer_daily_cap_check" CHECK ("customer_daily_cap" >= 1 and "customer_daily_cap" <= 10000);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "customer_access_mode" text DEFAULT 'approve_each' NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_customer_access_mode_check" CHECK ("customer_access_mode" in ('open_link', 'approve_each'));
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "notify_pending_email" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "pending_notified_at" timestamptz;
--> statement-breakpoint
CREATE TABLE "customer_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "label" text,
  "email" text,
  "all_offers" boolean DEFAULT true NOT NULL,
  "daily_cap" integer DEFAULT 20 NOT NULL,
  "max_uses" integer,
  "uses" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  "rotated_at" timestamptz,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "customer_invites_kind_check" CHECK ("kind" in ('personal', 'public')),
  CONSTRAINT "customer_invites_label_check" CHECK ("label" is null or char_length("label") <= 80),
  CONSTRAINT "customer_invites_email_check" CHECK ("email" is null or "kind" = 'personal'),
  CONSTRAINT "customer_invites_daily_cap_check" CHECK ("daily_cap" >= 1 and "daily_cap" <= 10000),
  CONSTRAINT "customer_invites_max_uses_check" CHECK ("max_uses" is null or ("max_uses" >= 1 and "max_uses" <= 100000)),
  CONSTRAINT "customer_invites_personal_uses_check" CHECK ("kind" <> 'personal' or "max_uses" = 1),
  CONSTRAINT "customer_invites_uses_check" CHECK ("uses" >= 0 and ("max_uses" is null or "uses" <= "max_uses"))
);
--> statement-breakpoint
ALTER TABLE "customer_invites" ADD CONSTRAINT "customer_invites_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_invites" ADD CONSTRAINT "customer_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_invites_token_hash_unique" ON "customer_invites" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "customer_invites_agent_idx" ON "customer_invites" USING btree ("agent_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_invites_one_public_link" ON "customer_invites" USING btree ("agent_id") WHERE "kind" = 'public' and "revoked_at" is null;
--> statement-breakpoint
CREATE TABLE "customer_invite_offers" (
  "invite_id" uuid NOT NULL,
  "offer_id" uuid NOT NULL,
  CONSTRAINT "customer_invite_offers_invite_id_offer_id_pk" PRIMARY KEY("invite_id","offer_id")
);
--> statement-breakpoint
ALTER TABLE "customer_invite_offers" ADD CONSTRAINT "customer_invite_offers_invite_id_customer_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."customer_invites"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_invite_offers" ADD CONSTRAINT "customer_invite_offers_offer_id_agent_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."agent_offers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "customer_preapproved_emails" (
  "agent_id" uuid NOT NULL,
  "email" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "customer_preapproved_emails_agent_id_email_pk" PRIMARY KEY("agent_id","email"),
  CONSTRAINT "customer_preapproved_emails_lower_check" CHECK ("email" = lower("email"))
);
--> statement-breakpoint
ALTER TABLE "customer_preapproved_emails" ADD CONSTRAINT "customer_preapproved_emails_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD COLUMN "source" text DEFAULT 'handle' NOT NULL;
--> statement-breakpoint
UPDATE "agent_shares" SET "source" = 'agent_invite' WHERE "invite_id" is not null;
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_source_check" CHECK ("source" in ('handle', 'agent_invite', 'customer'));
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD COLUMN "customer_invite_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_customer_invite_id_customer_invites_id_fk" FOREIGN KEY ("customer_invite_id") REFERENCES "public"."customer_invites"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD COLUMN "requested_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD COLUMN "redeem_source_hash" text;
--> statement-breakpoint
CREATE INDEX "agent_shares_agent_status_idx" ON "agent_shares" USING btree ("agent_id","status");
--> statement-breakpoint
CREATE INDEX "agent_shares_redeem_source_idx" ON "agent_shares" USING btree ("invite_id","redeem_source_hash") WHERE "redeem_source_hash" is not null;
