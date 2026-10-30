CREATE TABLE "agent_branding" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"primary_color" text,
	"accent_color" text,
	"logo_blob_path" text,
	"logo_url" text,
	"logo_width" integer,
	"logo_height" integer,
	"logo_sha256" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "agent_branding_primary_color_check" CHECK ("primary_color" is null or "primary_color" ~ '^#[0-9A-F]{6}$'),
	CONSTRAINT "agent_branding_accent_color_check" CHECK ("accent_color" is null or "accent_color" ~ '^#[0-9A-F]{6}$'),
	CONSTRAINT "agent_branding_logo_check" CHECK (("logo_url" is null) = ("logo_blob_path" is null))
);
--> statement-breakpoint
ALTER TABLE "agent_branding" ADD CONSTRAINT "agent_branding_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "client_request_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "question_asked_at" timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_client_request_unique" ON "tasks" USING btree ("from_workspace_id","client_request_id") WHERE "client_request_id" is not null;
--> statement-breakpoint
CREATE INDEX "tasks_from_workspace_to_agent_idx" ON "tasks" USING btree ("from_workspace_id","to_agent_id","created_at");
--> statement-breakpoint
CREATE TABLE "task_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"asked_at" timestamptz NOT NULL,
	"answered_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_answers" ADD CONSTRAINT "task_answers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "task_answers_task_idx" ON "task_answers" USING btree ("task_id","answered_at");
--> statement-breakpoint
ALTER TABLE "wakes" DROP CONSTRAINT "wakes_reason_check";
--> statement-breakpoint
ALTER TABLE "wakes" ADD CONSTRAINT "wakes_reason_check" CHECK ("reason" in ('message', 'task', 'result', 'question', 'failure', 'test', 'answer'));
