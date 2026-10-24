ALTER TABLE "agents" ADD COLUMN "local_driver" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "local_target" text;
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "agents_delivery_mode_check";
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_delivery_mode_check" CHECK ("delivery_mode" in ('none', 'webhook', 'herdr', 'local'));
--> statement-breakpoint
UPDATE "agents"
SET
  "delivery_mode" = 'local',
  "local_driver" = 'herdr',
  "local_target" = "herdr_pane"
WHERE "delivery_mode" = 'herdr';
