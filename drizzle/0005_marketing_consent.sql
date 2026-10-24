ALTER TABLE "users" ADD COLUMN "marketing_opt_in" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_consent_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_consent_text" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_unsubscribed_at" timestamptz;
