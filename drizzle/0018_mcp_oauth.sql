-- MCP OAuth (docs/design/mcp-oauth.md §3): six new tables, purely additive. No existing table changes.
-- Nothing reads or writes these tables unless MCP_OAUTH_ENABLED=1. Roll back by dropping the six tables.
-- Every secret column holds sha256 hex, the same as agent_keys, sessions and join_codes.
CREATE TABLE "oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"kind" text NOT NULL,
	"client_name" text NOT NULL,
	"client_uri" text,
	"redirect_uris" jsonb NOT NULL,
	"token_endpoint_auth_method" text NOT NULL,
	"client_secret_hash" text,
	"grant_types" jsonb DEFAULT '["authorization_code","refresh_token"]'::jsonb NOT NULL,
	"application_type" text,
	"metadata_expires_at" timestamp with time zone,
	"metadata_fetched_at" timestamp with time zone,
	"registered_ip_hash" text,
	"disabled_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_clients_kind_check" CHECK ("oauth_clients"."kind" in ('dcr', 'cimd')),
	CONSTRAINT "oauth_clients_auth_method_check" CHECK ("oauth_clients"."token_endpoint_auth_method" in ('none', 'client_secret_post', 'client_secret_basic'))
);
--> statement-breakpoint
CREATE TABLE "oauth_authorization_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_hash" text NOT NULL,
	"binding_hash" text NOT NULL,
	"client_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"state" text,
	"code_challenge" text NOT NULL,
	"scope" text NOT NULL,
	"resource" text NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_created" boolean NOT NULL,
	"scope" text NOT NULL,
	"resource" text NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_grants_revoked_reason_check" CHECK ("oauth_grants"."revoked_reason" is null or "oauth_grants"."revoked_reason" in ('user', 'agent_revoked', 'refresh_reuse', 'code_reuse', 'client_disabled', 'user_left_workspace', 'reconnected'))
);
--> statement-breakpoint
CREATE TABLE "oauth_authorization_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid,
	"new_agent_name" text,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"grant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_authorization_codes_agent_xor" CHECK (("oauth_authorization_codes"."agent_id" is null) <> ("oauth_authorization_codes"."new_agent_name" is null))
);
--> statement-breakpoint
CREATE TABLE "oauth_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"parent_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_parent_id_oauth_refresh_tokens_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."oauth_refresh_tokens"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_access_tokens_token_hash_unique" ON "oauth_access_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_grant_idx" ON "oauth_access_tokens" USING btree ("grant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_authorization_codes_code_hash_unique" ON "oauth_authorization_codes" USING btree ("code_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_authorization_requests_request_hash_unique" ON "oauth_authorization_requests" USING btree ("request_hash");
--> statement-breakpoint
CREATE INDEX "oauth_authorization_requests_expires_idx" ON "oauth_authorization_requests" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_clients_client_id_unique" ON "oauth_clients" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX "oauth_clients_kind_created_idx" ON "oauth_clients" USING btree ("kind","created_at");
--> statement-breakpoint
CREATE INDEX "oauth_grants_workspace_created_idx" ON "oauth_grants" USING btree ("workspace_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "oauth_grants_agent_idx" ON "oauth_grants" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX "oauth_grants_client_idx" ON "oauth_grants" USING btree ("client_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_refresh_tokens_token_hash_unique" ON "oauth_refresh_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "oauth_refresh_tokens_grant_idx" ON "oauth_refresh_tokens" USING btree ("grant_id");
--> statement-breakpoint
CREATE INDEX "oauth_refresh_tokens_parent_idx" ON "oauth_refresh_tokens" USING btree ("parent_id");
