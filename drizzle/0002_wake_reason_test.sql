ALTER TABLE "wakes" DROP CONSTRAINT "wakes_reason_check";
--> statement-breakpoint
ALTER TABLE "wakes" ADD CONSTRAINT "wakes_reason_check" CHECK ("reason" in ('message', 'task', 'result', 'question', 'failure', 'test'));
