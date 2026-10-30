ALTER TABLE "agent_offers" ADD COLUMN "input_schema" jsonb;
--> statement-breakpoint
ALTER TABLE "agent_offers" ADD COLUMN "notes_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_offers" ADD CONSTRAINT "agent_offers_notes_check" CHECK ("notes_enabled" or "input_schema" is not null);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "input_schema" jsonb;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "input" jsonb;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_input_pair_check" CHECK (("input" is null) = ("input_schema" is null));
