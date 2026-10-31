ALTER TABLE "agents" ADD COLUMN "review_mode" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_review_mode_check" CHECK ("review_mode" is null or "review_mode" in ('auto', 'review_first')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "agents" VALIDATE CONSTRAINT "agents_review_mode_check";
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "notify_review_email" boolean;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "review_notified_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "review_mode" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "held_action" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "reviewed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "reviewed_by" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "released_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "owner_note" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_reviewed_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_review_mode_check" CHECK ("review_mode" is null or "review_mode" in ('auto', 'review_first')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_review_mode_check";
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_held_action_check" CHECK ("held_action" is null or "held_action" in ('result', 'question', 'failure')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_held_action_check";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_status_check";
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_check" CHECK ("status" in ('open', 'done', 'needs_info', 'failed', 'in_review', 'awaiting_release')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_status_check";
--> statement-breakpoint
CREATE INDEX "tasks_held_idx" ON "tasks" USING btree ("workspace_id","updated_at") WHERE "status" in ('in_review', 'awaiting_release');
--> statement-breakpoint
ALTER TABLE "wakes" DROP CONSTRAINT "wakes_reason_check";
--> statement-breakpoint
ALTER TABLE "wakes" ADD CONSTRAINT "wakes_reason_check" CHECK ("reason" in ('message', 'task', 'result', 'question', 'failure', 'test', 'answer', 'review_needed', 'sent_back')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "wakes" VALIDATE CONSTRAINT "wakes_reason_check";
