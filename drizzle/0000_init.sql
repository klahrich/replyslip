CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid REFERENCES "workspaces"("id"),
  "email" text NOT NULL,
  "email_verified_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");
--> statement-breakpoint
CREATE TABLE "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" ("token_hash");
--> statement-breakpoint
CREATE TABLE "login_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "consumed_at" timestamptz,
  "invalidated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "login_codes_email_created_idx" ON "login_codes" ("email", "created_at");
--> statement-breakpoint
CREATE TABLE "rate_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL,
  "email" text,
  "ip" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "rate_events_lookup_idx" ON "rate_events" ("kind", "created_at");
--> statement-breakpoint
CREATE TABLE "agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "name" text NOT NULL,
  "description" text,
  "delivery_mode" text NOT NULL DEFAULT 'none',
  "webhook_url" text,
  "webhook_auth_mode" text,
  "webhook_secret_ciphertext" text,
  "webhook_headers_ciphertext" text,
  "herdr_pane" text,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "agents_delivery_mode_check" CHECK ("delivery_mode" in ('none', 'webhook', 'herdr'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agents_workspace_name_unique" ON "agents" ("workspace_id", "name");
--> statement-breakpoint
CREATE TABLE "agent_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "last_used_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_keys_token_hash_unique" ON "agent_keys" ("token_hash");
--> statement-breakpoint
CREATE TABLE "join_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "consumed_at" timestamptz,
  "consumed_by_agent_id" uuid REFERENCES "agents"("id"),
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "join_codes_token_hash_unique" ON "join_codes" ("token_hash");
--> statement-breakpoint
CREATE INDEX "join_codes_workspace_idx" ON "join_codes" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE TABLE "watcher_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "name" text NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "last_used_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "watcher_keys_token_hash_unique" ON "watcher_keys" ("token_hash");
--> statement-breakpoint
CREATE TABLE "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "from_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "to_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "title" text NOT NULL,
  "description" text NOT NULL,
  "result_schema" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "result" jsonb,
  "question" text,
  "fail_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  CONSTRAINT "tasks_status_check" CHECK ("status" in ('open', 'done', 'needs_info', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "tasks_workspace_created_idx" ON "tasks" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE INDEX "tasks_to_agent_idx" ON "tasks" ("to_agent_id", "status");
--> statement-breakpoint
CREATE INDEX "tasks_from_agent_idx" ON "tasks" ("from_agent_id", "status");
--> statement-breakpoint
CREATE TABLE "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "from_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "to_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "body" text NOT NULL,
  "task_id" uuid REFERENCES "tasks"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "messages_task_idx" ON "messages" ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX "messages_to_agent_idx" ON "messages" ("to_agent_id", "created_at");
--> statement-breakpoint
CREATE TABLE "wakes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "reason" text NOT NULL,
  "task_id" uuid REFERENCES "tasks"("id"),
  "message_id" uuid REFERENCES "messages"("id"),
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "last_error" text,
  "delivered_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "wakes_status_check" CHECK ("status" in ('pending', 'delivered', 'failed', 'cancelled')),
  CONSTRAINT "wakes_reason_check" CHECK ("reason" in ('message', 'task', 'result', 'question', 'failure'))
);
--> statement-breakpoint
CREATE INDEX "wakes_due_idx" ON "wakes" ("status", "next_attempt_at");
