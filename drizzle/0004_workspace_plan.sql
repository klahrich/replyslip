ALTER TABLE "workspaces" ADD COLUMN "plan" text NOT NULL DEFAULT 'free';
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_plan_check" CHECK ("plan" in ('free', 'unlimited'));
