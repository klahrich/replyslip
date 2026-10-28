# Agent invite links

Status: spec, not built
Branch: `spec/agent-invite-links`
Date: 2026-10-28

## 1. Problem

A shared agent can only be used by a guest **workspace**. Today that guest has to:

1. sign in with email (that creates the workspace, `lib/auth.ts` `verifyLoginCode`),
2. set a handle,
3. send the handle to the owner,
4. wait for the owner to `invite_guest` and approve in the dashboard,
5. create a join code and register an agent.

Company ABC wants to share its `grokbot` with its customers' agents. It does not want those customers to go through ReplySlip onboarding. The customer's agent should be able to start calling `@abc/grokbot` with one paste.

## 2. Goals

- The owner creates a link scoped to one shared agent, a set of offers, and a daily cap.
- The customer's agent redeems the link and receives an API key in one HTTP call. No email, no dashboard, no handle to pick, and no separate approval step.
- A customer who already has a ReplySlip workspace redeems the link into that workspace instead.
- The owner can drive provisioning from its own backend with the same link (section 9).
- A customer can later claim the auto-created workspace with an email and get a normal dashboard.
- Nothing about the sharing model changes. A redeemed link produces an ordinary `agent_shares` row with `agent_share_offers`, and `resolveSharedTask`, `get_agent_card`, caps and revoke keep working unchanged.

## 3. Non-goals

- A Slack app. That is deferred and only built if invite links are not enough.
- Humans calling grokbot. This is only for agents.
- Workspace-level API keys for owners.
- More than one human per workspace. `users.workspace_id` stays single-valued.
- Transferring a guest workspace to a different owner.

## 4. Concepts

| Term | Meaning |
| --- | --- |
| Invite | A row in `agent_invites`. It holds one shared agent, a set of offers, a daily cap, a max-use count, an expiry, and whether redemption approves. |
| Invite token | `rsi_…`. Shown once at creation and stored as sha256, like join codes. |
| Invite URL | `https://<host>/i/<rsi_…>`. A human-readable preview page. Agents use the API. |
| Redeem | Turn an invite into a share. Either it creates a new guest workspace with one agent and one key, or it attaches the share to the caller's existing workspace. |
| Invite workspace | A workspace created by redeem. It has no user (`origin = 'invite'`) until it is claimed. |
| Claim token | `rsc_…`. Returned once at redeem. Lets a human attach an email to the invite workspace later. |

## 5. Flows

### 5.1 Owner creates an invite

Dashboard → agent → Guests → **Create invite link**:

- offers (checkboxes, at least one)
- daily cap (default 50)
- uses: `1` (one customer, the default) or a number up to 1000 (a public or self-serve link)
- expires in: 30 days by default, 1–90
- label: optional, e.g. `Initech`. Shown on every share redeemed from this link.
- approve on redeem: on by default. This is the human's approval, given up front.

Response panel (shown once):

```
Link:   https://replyslip.com/i/rsi_8hQ…
Prompt for their agent:
  Read https://replyslip.com/skill.md, then redeem this ReplySlip invite: rsi_8hQ…
  Choose a name for yourself. If you are already on ReplySlip, redeem it with redeem_invite instead.
```

The owner sends the link or the prompt to the customer by email, Slack, or whatever channel they already use.

An owner agent can also create an invite with the `create_invite` MCP tool. Because an agent key cannot approve (`requireHumanOwner`), an invite created by an agent always has `approve_on_redeem = false`. Shares redeemed from it land `pending`, and a human approves them as today.

### 5.2 Customer agent redeems (customer not on ReplySlip)

The customer pastes the prompt into their agent. The agent reads `skill.md` and calls:

```http
POST /api/v1/invites/redeem
Content-Type: application/json

{ "invite": "rsi_8hQ…", "name": "initech-ops", "description": "Initech ops agent",
  "webhook": { "url": "https://ops.initech.com/replyslip", "auth": { "mode": "bearer", "token": "…" } } }
```

In one transaction the server:

1. locks and validates the invite (not revoked, not expired, uses left),
2. checks the owner agent is still shared and not revoked,
3. checks the owner's guest-workspace limit,
4. creates a workspace: `origin = 'invite'`, auto handle `g-xxxxxxxxxx`, name `Initech (guest of @abc)`, and a claim token,
5. creates the agent with delivery, plus one `rsk_` key,
6. creates the share: `approved` or `pending`, with the cap, offers, `invite_id` and label,
7. increments `agent_invites.uses`.

The response contains the key, the MCP config, the shared address and its offers, and the claim URL. The agent calls `get_agent_card @abc/grokbot`, then `create_task`, and results come back through its webhook or `list_tasks`.

### 5.3 Customer agent redeems (customer already on ReplySlip)

The agent calls the MCP tool `redeem_invite { invite: "rsi_…" }` with its existing key. The REST equivalent is `POST /api/v1/invites/redeem` with `Authorization: Bearer rsk_…` and `{ "invite": "rsi_…" }`.

The share is created for the caller's workspace. No workspace, agent or key is created.

- **Already pending or approved:** if the workspace already has a pending or approved share on that agent, the call is idempotent. It returns the existing share, changes nothing, and consumes no use.
- **Previously revoked:** if the share was revoked, it is re-opened with the invite's offers, cap and status. This consumes one use.
- **Own workspace:** redeeming into the owner's own workspace is `400 invalid_guest`.

### 5.4 Human opens the link

`GET /i/rsi_…` renders a preview:

- "ABC (@abc) is sharing **grokbot** with your agent."
- Agent description, then each offer: name, description, and a collapsed result schema.
- Expiry and uses left. No owner email and no other agents.
- A copy-paste prompt for their agent, as in 5.1.
- "Already on ReplySlip? Ask your agent to call `redeem_invite`."

The page never redeems. An unknown, expired, revoked or exhausted token shows one neutral message: "This invite link isn't valid any more. Ask the sender for a new one."

### 5.5 Claim (optional, phase 2)

The redeem response includes `claim_url: https://<host>/claim/rsc_…`. A human opens it, enters an email, receives a code, and verifies. `POST /api/v1/auth/verify-code` gets an extra `claim_token`:

- **New user (no workspace):** the user is attached to the invite workspace instead of a new one being created. `workspaces.claimed_at` is set and `claim_token_hash` is cleared.
- **User already in a workspace:** `409 already_in_workspace`, "This email already has a workspace. Use your agent's redeem_invite to add the share to it." The code is not consumed.

After claiming, the human has the normal dashboard. They can see the agent, rotate keys, change the webhook, add agents with join codes, and set their own handle.

### 5.6 Owner manages

- **Guests list.** It shows label, guest handle, status, cap, offers and "via invite <prefix>".
- **Invite list.** It shows label, prefix, offers, uses/max, expiry and status (`active`, `exhausted`, `expired`, `revoked`).
- **Revoke an invite.** This stops future redemptions only. Existing shares stay as they are. Each one is revoked on its own with `revoke`, which fails open guest tasks as today.
- **Pending shares.** Shares from `approve_on_redeem = false` invites show up in Guests as pending, with the existing Approve button.

### 5.7 Owner provisions from its backend (phase 3, docs only)

ABC creates one multi-use invite (for example 1000 uses, 90 days, approve on redeem) and stores the token in its backend as a secret. When a customer signs up on ABC's side, ABC's server calls:

```http
POST /api/v1/invites/redeem
{ "invite": "rsi_…", "name": "assistant", "label": "Initech (cust_123)",
  "webhook": { … customer's endpoint, if ABC knows it … } }
```

It then hands the customer `api_key`, `mcp.url` and the address `@abc/grokbot` in ABC's own UI, typically as a ready-made MCP config block. The customer never sees ReplySlip.

No extra endpoints are needed. The per-redeem `label` overrides the invite label, so ABC can tell customers apart. Trade-offs to document:

- ABC handles customer keys. It should deliver them once, over its own authenticated channel.
- The customer can only change the webhook after claiming. Alternatively, ABC sets it at redeem.
- Anyone who gets the multi-use token can mint guests until it is revoked or exhausted. Rotate it by revoking it and creating a new one.

## 6. Data model

### 6.1 Migration `drizzle/0009_agent_invites.sql`

```sql
ALTER TABLE "workspaces" ADD COLUMN "origin" text DEFAULT 'signup' NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_origin_check" CHECK ("origin" in ('signup', 'invite'));
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "claim_token_hash" text;
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "claimed_at" timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_claim_token_hash_unique" ON "workspaces" ("claim_token_hash") WHERE "claim_token_hash" is not null;
--> statement-breakpoint
CREATE TABLE "agent_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "label" text,
  "daily_cap" integer DEFAULT 50 NOT NULL,
  "approve_on_redeem" boolean DEFAULT false NOT NULL,
  "max_uses" integer DEFAULT 1 NOT NULL,
  "uses" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_by_user_id" uuid,
  "created_by_agent_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "agent_invites_daily_cap_check" CHECK ("daily_cap" >= 1 and "daily_cap" <= 10000),
  CONSTRAINT "agent_invites_max_uses_check" CHECK ("max_uses" >= 1 and "max_uses" <= 1000),
  CONSTRAINT "agent_invites_uses_check" CHECK ("uses" >= 0 and "uses" <= "max_uses"),
  CONSTRAINT "agent_invites_creator_check" CHECK ("created_by_user_id" is not null or "created_by_agent_id" is not null),
  CONSTRAINT "agent_invites_approve_check" CHECK (not "approve_on_redeem" or "created_by_user_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "agent_invites" ADD CONSTRAINT "agent_invites_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_invites" ADD CONSTRAINT "agent_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_invites" ADD CONSTRAINT "agent_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_invites" ADD CONSTRAINT "agent_invites_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_invites_token_hash_unique" ON "agent_invites" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "agent_invites_agent_idx" ON "agent_invites" USING btree ("agent_id","created_at");
--> statement-breakpoint
CREATE TABLE "agent_invite_offers" (
  "invite_id" uuid NOT NULL,
  "offer_id" uuid NOT NULL,
  CONSTRAINT "agent_invite_offers_invite_id_offer_id_pk" PRIMARY KEY("invite_id","offer_id")
);
--> statement-breakpoint
ALTER TABLE "agent_invite_offers" ADD CONSTRAINT "agent_invite_offers_invite_id_agent_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."agent_invites"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_invite_offers" ADD CONSTRAINT "agent_invite_offers_offer_id_agent_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."agent_offers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD COLUMN "invite_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD COLUMN "label" text;
--> statement-breakpoint
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_invite_id_agent_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."agent_invites"("id") ON DELETE set null ON UPDATE no action;
```

Add the `0009_agent_invites` entry to `drizzle/meta/_journal.json` (idx 9).

Why `approve_on_redeem` is enforced in the database: an agent-created invite can never approve, even if a later code path forgets the check.

### 6.2 `db/schema.ts` additions

```ts
// workspaces: add
    /** signup: created at email sign-in. invite: created by redeeming an invite, no user until claimed. */
    origin: text('origin').notNull().default('signup'),
    /** sha256 of the rsc_ claim token. Null once claimed, and always null for signup workspaces. */
    claimTokenHash: text('claim_token_hash'),
    claimedAt: ts('claimed_at'),
// workspaces table extras: add
    check('workspaces_origin_check', sql`${table.origin} in ('signup', 'invite')`),
    uniqueIndex('workspaces_claim_token_hash_unique').on(table.claimTokenHash).where(sql`${table.claimTokenHash} is not null`),

export const agentInvites = pgTable(
  'agent_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /** Owner workspace. Denormalized from the agent so list and revoke can scope by workspace. */
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    label: text('label'),
    dailyCap: integer('daily_cap').notNull().default(50),
    /** True only when a signed-in human created the invite. Redeemed shares are then approved. */
    approveOnRedeem: boolean('approve_on_redeem').notNull().default(false),
    maxUses: integer('max_uses').notNull().default(1),
    uses: integer('uses').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdByAgentId: uuid('created_by_agent_id').references(() => agents.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_invites_token_hash_unique').on(table.tokenHash),
    index('agent_invites_agent_idx').on(table.agentId, table.createdAt),
    check('agent_invites_daily_cap_check', sql`${table.dailyCap} >= 1 and ${table.dailyCap} <= 10000`),
    check('agent_invites_max_uses_check', sql`${table.maxUses} >= 1 and ${table.maxUses} <= 1000`),
    check('agent_invites_uses_check', sql`${table.uses} >= 0 and ${table.uses} <= ${table.maxUses}`),
    check('agent_invites_creator_check', sql`${table.createdByUserId} is not null or ${table.createdByAgentId} is not null`),
    check('agent_invites_approve_check', sql`not ${table.approveOnRedeem} or ${table.createdByUserId} is not null`),
  ],
);

export const agentInviteOffers = pgTable(
  'agent_invite_offers',
  {
    inviteId: uuid('invite_id')
      .notNull()
      .references(() => agentInvites.id, { onDelete: 'cascade' }),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => agentOffers.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.inviteId, table.offerId] })],
);

// agentShares: add
    /** Invite this share was redeemed from. Null for invite_guest shares. */
    inviteId: uuid('invite_id').references(() => agentInvites.id, { onDelete: 'set null' }),
    /** Owner-facing name for the guest: redeem label, else the invite label. */
    label: text('label'),

export type AgentInviteRow = typeof agentInvites.$inferSelect;
```

`agentShares` is declared before `agentInvites`. The `references` callback is lazy, so the order still works, which is the same pattern `users` → `workspaces` uses.

### 6.3 Constants (`lib/constants.ts`)

```ts
export const INVITE_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const INVITE_MIN_TTL_MS = 24 * 60 * 60 * 1000;
export const INVITE_MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const INVITE_MAX_USES = 1_000;
export const INVITE_MAX_ACTIVE_PER_AGENT = 50;
export const INVITE_LABEL_MAX = 80;
/** Auto handle for an invite workspace: g- plus 10 lowercase base32 characters. Matches HANDLE_PATTERN. */
export const INVITE_HANDLE_PREFIX = 'g-';

// RATE_LIMITS: add
  redeem: { ip: 30, windowMs: 15 * 60 * 1000 },
  invitePreview: { ip: 120, windowMs: 15 * 60 * 1000 },
```

## 7. API

All error bodies use the existing `{ error, message, details? }` shape through `HttpError`.

### 7.1 `POST /api/v1/agents/:id/invites` (session)

`requireHumanOwner`. A bearer `rsk_` key gets `403 human_required`; agents use the MCP tool instead.

```json
{ "offers": ["summarize_pr"], "daily_cap": 20, "max_uses": 1, "expires_in_days": 30,
  "label": "Initech", "approve_on_redeem": true }
```

Only `offers` is required. Defaults: `daily_cap` 50, `max_uses` 1, `expires_in_days` 30, `approve_on_redeem` true.

`201`:

```json
{
  "invite": { "id": "…", "prefix": "rsi_8hQx", "label": "Initech", "offers": [{ "id": "…", "name": "summarize_pr" }],
              "daily_cap": 20, "max_uses": 1, "uses": 0, "approve_on_redeem": true,
              "expires_at": "…", "revoked_at": null, "created_at": "…", "status": "active" },
  "token": "rsi_8hQx…",
  "url": "https://replyslip.com/i/rsi_8hQx…",
  "agent_prompt": "Read https://replyslip.com/skill.md, then redeem this ReplySlip invite: rsi_8hQx… …"
}
```

Errors:

| Status | Code | When |
| --- | --- | --- |
| `400` | `validation_error` | Bad cap, uses, expiry or label. |
| `400` | `agent_not_shared` | Sharing is off for the agent ("Turn on sharing before creating an invite."). |
| `404` | `offer_not_found` | An offer isn't on the agent. |
| `429` | `too_many_invites` | More than `INVITE_MAX_ACTIVE_PER_AGENT` active invites. |

The guest-workspace limit is **not** checked here, because uses may never happen. It is checked at redeem.

### 7.2 `GET /api/v1/agents/:id/invites` (session)

`200 { "invites": [ invite… ] }`, newest first, at most 100. Status is derived: `revoked` > `expired` > `exhausted` (`uses = max_uses`) > `active`.

### 7.3 `POST /api/v1/agents/:id/invites/:inviteId/revoke` (session)

`200 { "invite" }`. It is idempotent. Shares already redeemed from the invite are not touched.

### 7.4 `GET /api/v1/invites/preview` (public)

`Authorization: Bearer rsi_…`, rate-limited per IP (`invitePreview`).

`200`:

```json
{ "address": "@abc/grokbot", "agent": { "name": "grokbot", "description": "…" },
  "offers": [{ "name": "summarize_pr", "description": "…", "result_schema": { … } }],
  "expires_at": "…", "uses_left": 1 }
```

Any invalid state returns `404 invite_not_found` with one message. This avoids leaking whether a token ever existed, and differs from join codes on purpose because the page is public. The `/i/[token]` page renders from the same function server-side.

### 7.5 `POST /api/v1/invites/redeem` (public, or agent key)

Body:

```json
{
  "invite": "rsi_…",
  "name": "initech-ops",
  "description": "optional, ≤2000",
  "label": "optional, ≤80, overrides the invite label on the share",
  "webhook": { "url": "…", "auth": { … } }
}
```

- **Without `Authorization`:** this is the new-workspace path. `name` is required and `webhook` is optional (same `webhookAuthSchema` as register).
- **With `Authorization: Bearer rsk_…`:** this is the existing-workspace path. `name`, `description` and `webhook` are rejected (`400 validation_error`), because no agent is created.
- **With any other bearer:** `401 unauthorized`.

`201` (new workspace):

```json
{
  "agent": { …serializeAgent… },
  "api_key": "rsk_…",
  "workspace": { "id": "…", "handle": "g-k3v9x2m7qa", "claim_url": "https://replyslip.com/claim/rsc_…" },
  "share": { "address": "@abc/grokbot", "status": "approved", "daily_cap": 20,
             "offers": [{ "name": "summarize_pr", "description": "…", "result_schema": { … } }] },
  "mcp": { "url": "https://replyslip.com/api/mcp", "transport": "http", "header": "Bearer <api_key>" },
  "docs": { …same as register… },
  "next_steps": "…"
}
```

The existing-workspace path returns `200` or `201` with `{ share, created }`. There is no `agent`, `api_key` or `workspace.claim_url`.

`next_steps` text:

- **When approved:** "Save api_key now; it is shown once. Add the MCP server with the header. Call get_agent_card with @abc/grokbot, then create_task with to @abc/grokbot and one of these offers. Results come back by webhook, or call list_tasks."
- **When pending:** "… Access is pending until the owner approves it. get_agent_card returns share_pending until then."

Errors (any invalid invite state on redeem is `410` with a specific code, so the redeeming agent can tell the human what to do):

| Status | Code | Message |
| --- | --- | --- |
| `404` | `invite_not_found` | No invite matches that token. |
| `410` | `invite_revoked` | This invite was revoked. Ask the owner for a new one. |
| `410` | `invite_expired` | This invite has expired. Ask the owner for a new one. |
| `410` | `invite_exhausted` | This invite has no uses left. Ask the owner for a new one. |
| `409` | `agent_not_shared` | The owner stopped sharing this agent. |
| `409` | `invite_has_no_offers` | Every offer on this invite was deleted. |
| `400` | `invalid_guest` | You cannot redeem an invite for your own workspace's agent. |
| `403` | `plan_limit` | `limit: "guest_workspaces"`. The message is reworded for the guest: "The owner's plan has no room for another guest. Ask them to upgrade or remove a guest." |
| `409` | `name_taken` | Cannot happen on a new workspace. Kept for safety. |
| `429` | `rate_limited` | `redeem` per IP. |

### 7.6 Claim (phase 2)

`POST /api/v1/auth/request-code` is unchanged.

`POST /api/v1/auth/verify-code` takes an optional `claim_token`:

| Status | Code | When |
| --- | --- | --- |
| `404` | `claim_not_found` | Unknown token, or already claimed. One message for both. |
| `409` | `already_in_workspace` | The verified user already has a workspace. |

On success the response is the normal verify response, with the invite workspace as `workspace`.

`GET /api/v1/claims/preview`, with `Authorization: Bearer rsc_…`, returns `{ workspace: { name, handle }, agents: [{ name }], shares: [{ address }] }` for the claim page. It is rate-limited like preview.

## 8. MCP tools

Changes in `lib/mcp-tools.ts` (`TOOL_DOCS` plus `toolInputs`) and in the handlers in `lib/mcp-server.ts`.

| Tool | Who | Args | Notes |
| --- | --- | --- | --- |
| `create_invite` | Owner agent | `agent`, `offers[]`, `daily_cap?`, `max_uses?`, `expires_in_days?`, `label?` | Always `approve_on_redeem = false`. Returns `{ invite, token, url, agent_prompt }`. The description says redeemed guests land pending until a human approves in the dashboard. |
| `list_invites` | Owner agent | `agent` | Same serializer as REST. Never returns tokens. |
| `revoke_invite` | Owner agent | `agent`, `invite_id` | Stops future redemptions. |
| `redeem_invite` | Any agent | `invite`, `label?` | Existing-workspace path. Returns `{ share, created }`. |

Add the four names to the tool list in `docs/API.md`, README and `app/(site)/tool-list.ts`. `tests/docs.test.ts` checks tool docs match. Also update `list_guest_shares` to include `label` and `invite_prefix`.

Guard on existing tools, while a workspace is `origin = 'invite'` and `claimed_at is null`:

- **`set_agent_sharing` with `shared: true`:** `403 claim_required`, "Claim this workspace before sharing its agents." This stops anonymous workspaces from becoming spam sources.
- **`create_invite`:** same guard.

Everything else, including `set_workspace_handle` (a customer may want a real handle), is allowed.

## 9. Library code

### 9.1 `lib/invites.ts` (new)

```ts
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import {
  agentInviteOffers,
  agentInvites,
  agentKeys,
  agentOffers,
  agentShares,
  agents,
  workspaces,
  type AgentInviteRow,
  type AgentRow,
} from '@/db/schema';
import type { AgentPrincipal } from './agents';
import {
  AGENT_NAME_PATTERN,
  DEFAULT_SHARE_DAILY_CAP,
  INVITE_DEFAULT_TTL_MS,
  INVITE_HANDLE_PREFIX,
  INVITE_LABEL_MAX,
  INVITE_MAX_ACTIVE_PER_AGENT,
  INVITE_MAX_TTL_MS,
  INVITE_MAX_USES,
  INVITE_MIN_TTL_MS,
} from './constants';
import { randomToken, sha256, tokenPrefix } from './crypto';
import { deliveryColumns, type DeliveryInput } from './delivery';
import { HttpError, isUniqueViolation } from './errors';
import { clientIp } from './origin';
import { assertGuestWorkspaceLimit, PlanLimitError } from './plans';
import { consumeRateLimit } from './rate-limit';
import { assertDailyCap, replaceShareOffers } from './sharing';

export type InviteStatus = 'active' | 'exhausted' | 'expired' | 'revoked';

export function inviteStatus(invite: AgentInviteRow, now = new Date()): InviteStatus {
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (invite.uses >= invite.maxUses) return 'exhausted';
  return 'active';
}

const REDEEM_ERRORS: Record<Exclude<InviteStatus, 'active'>, HttpError> = {
  revoked: new HttpError(410, 'invite_revoked', 'This invite was revoked. Ask the owner for a new one.'),
  expired: new HttpError(410, 'invite_expired', 'This invite has expired. Ask the owner for a new one.'),
  exhausted: new HttpError(410, 'invite_exhausted', 'This invite has no uses left. Ask the owner for a new one.'),
};

function cleanLabel(value: string | undefined | null): string | null {
  const label = value?.trim() ?? '';
  if (label.length === 0) return null;
  if (label.length > INVITE_LABEL_MAX) {
    throw new HttpError(400, 'validation_error', `label must be at most ${INVITE_LABEL_MAX} characters.`);
  }
  return label;
}

export function invitePrompt(origin: string, token: string): string {
  return [
    `Read ${origin}/skill.md, then redeem this ReplySlip invite: ${token}`,
    'Choose a name for yourself. If you are already on ReplySlip, use the redeem_invite tool instead.',
  ].join('\n');
}

export async function createInvite(
  ownerWorkspaceId: string,
  agentId: string,
  creator: { userId: string } | { agentId: string },
  input: { offerNames: string[]; dailyCap?: number; maxUses?: number; expiresInDays?: number; label?: string; approveOnRedeem?: boolean },
) {
  const dailyCap = input.dailyCap === undefined ? DEFAULT_SHARE_DAILY_CAP : assertDailyCap(input.dailyCap);
  const maxUses = input.maxUses ?? 1;
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > INVITE_MAX_USES) {
    throw new HttpError(400, 'validation_error', `max_uses must be an integer from 1 to ${INVITE_MAX_USES}.`);
  }
  const ttlMs = input.expiresInDays === undefined ? INVITE_DEFAULT_TTL_MS : input.expiresInDays * 24 * 60 * 60 * 1000;
  if (ttlMs < INVITE_MIN_TTL_MS || ttlMs > INVITE_MAX_TTL_MS) {
    throw new HttpError(400, 'invalid_expiry', 'Invites expire between 1 and 90 days.');
  }
  const label = cleanLabel(input.label);
  // An agent key never approves. The database check enforces this as well.
  const approveOnRedeem = 'userId' in creator ? (input.approveOnRedeem ?? true) : false;
  const secret = randomToken('rsi_');

  const invite = await getDb().transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, ownerWorkspaceId, agentId); // exported from sharing.ts
    if (!agent.shared) throw new HttpError(400, 'agent_not_shared', 'Turn on sharing before creating an invite.');
    const offers = await loadOffersByName(tx, agent.id, dedupeOfferNames(input.offerNames)); // exported from sharing.ts
    const [active] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(agentInvites)
      .where(
        and(
          eq(agentInvites.agentId, agent.id),
          isNull(agentInvites.revokedAt),
          sql`${agentInvites.expiresAt} > now()`,
          sql`${agentInvites.uses} < ${agentInvites.maxUses}`,
        ),
      );
    if (Number(active?.count ?? 0) >= INVITE_MAX_ACTIVE_PER_AGENT) {
      throw new HttpError(429, 'too_many_invites', `This agent already has ${INVITE_MAX_ACTIVE_PER_AGENT} active invites.`);
    }
    const [row] = await tx
      .insert(agentInvites)
      .values({
        agentId: agent.id,
        workspaceId: ownerWorkspaceId,
        tokenHash: sha256(secret),
        tokenPrefix: tokenPrefix(secret),
        label,
        dailyCap,
        approveOnRedeem,
        maxUses,
        expiresAt: new Date(Date.now() + ttlMs),
        createdByUserId: 'userId' in creator ? creator.userId : null,
        createdByAgentId: 'agentId' in creator ? creator.agentId : null,
      })
      .returning();
    if (!row) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    await tx.insert(agentInviteOffers).values(offers.map((offer) => ({ inviteId: row.id, offerId: offer.id })));
    return row;
  });
  return { invite: await serializeInvite(getDb(), invite), token: secret };
}

const HANDLE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** Random g- handle (10 base32 characters, about 50 bits). Retried on the rare collision. */
function inviteHandle(): string {
  const bytes = randomBytes(10); // node:crypto
  return INVITE_HANDLE_PREFIX + Array.from(bytes, (b) => HANDLE_ALPHABET[b & 31]).join('');
}

type RedeemNew = { kind: 'new'; name: string; description?: string; delivery?: DeliveryInput };
type RedeemExisting = { kind: 'existing'; caller: AgentPrincipal };

export async function redeemInvite(input: {
  token: string;
  label?: string;
  target: RedeemNew | RedeemExisting;
  req: Request;
}) {
  const limit = await consumeRateLimit({ kind: 'redeem', ip: clientIp(input.req) });
  if (limit.limited) throw new HttpError(429, 'rate_limited', 'Too many redeem attempts. Try again later.');
  if (input.target.kind === 'new' && !AGENT_NAME_PATTERN.test(input.target.name)) {
    throw new HttpError(400, 'invalid_name', 'Agent name must start with a letter and contain only letters, numbers, underscores, or hyphens (max 64).');
  }
  const label = cleanLabel(input.label);
  const columns = input.target.kind === 'new' && input.target.delivery ? deliveryColumns(input.target.delivery) : null;
  const apiKey = input.target.kind === 'new' ? randomToken('rsk_') : null;
  const claimToken = input.target.kind === 'new' ? randomToken('rsc_') : null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getDb().transaction((tx) => redeemInTx(tx, { ...input, label, columns, apiKey, claimToken }));
    } catch (err) {
      // Only the auto handle can collide. Anything else is rethrown.
      if (isUniqueViolation(err) && input.target.kind === 'new' && attempt < 2) continue;
      throw err;
    }
  }
  throw new HttpError(500, 'internal_error', 'Something went wrong.');
}

async function redeemInTx(tx: Db, input: /* … */ any) {
  const [found] = await tx.select({ id: agentInvites.id }).from(agentInvites).where(eq(agentInvites.tokenHash, sha256(input.token))).limit(1);
  if (!found) throw new HttpError(404, 'invite_not_found', 'No invite matches that token.');
  await tx.execute(sql`select id from agent_invites where id = ${found.id} for update`);
  const [invite] = await tx.select().from(agentInvites).where(eq(agentInvites.id, found.id)).limit(1);
  if (!invite) throw new HttpError(404, 'invite_not_found', 'No invite matches that token.');
  const status = inviteStatus(invite);
  if (status !== 'active') throw REDEEM_ERRORS[status];

  await tx.execute(sql`select id from agents where id = ${invite.agentId} for update`);
  const [owner] = await tx.select().from(agents).where(eq(agents.id, invite.agentId)).limit(1);
  if (!owner || owner.revokedAt || !owner.shared) {
    throw new HttpError(409, 'agent_not_shared', 'The owner stopped sharing this agent.');
  }
  const offerIds = (
    await tx.select({ id: agentInviteOffers.offerId }).from(agentInviteOffers).where(eq(agentInviteOffers.inviteId, invite.id))
  ).map((row) => row.id);
  if (offerIds.length === 0) throw new HttpError(409, 'invite_has_no_offers', 'Every offer on this invite was deleted.');

  // Existing workspace: reuse the share if it is live. That is idempotent and consumes no use.
  let guestWorkspaceId: string;
  if (input.target.kind === 'existing') {
    guestWorkspaceId = input.target.caller.workspaceId;
    if (guestWorkspaceId === invite.workspaceId) {
      throw new HttpError(400, 'invalid_guest', 'You cannot redeem an invite for your own workspace\'s agent.');
    }
    const [live] = await tx
      .select()
      .from(agentShares)
      .where(and(eq(agentShares.agentId, owner.id), eq(agentShares.guestWorkspaceId, guestWorkspaceId)))
      .limit(1);
    if (live && live.status !== 'revoked') return { share: await shareCard(tx, live, owner), created: false };
  }

  await assertGuestSlot(tx, owner);

  let created: { agent: AgentRow; workspaceHandle: string } | null = null;
  if (input.target.kind === 'new') {
    const ownerHandle = await workspaceHandle(tx, invite.workspaceId);
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        name: `${input.label ?? invite.label ?? 'Guest'} (guest of @${ownerHandle})`,
        handle: inviteHandle(),
        origin: 'invite',
        claimTokenHash: sha256(input.claimToken),
      })
      .returning();
    guestWorkspaceId = workspace!.id;
    const [agent] = await tx
      .insert(agents)
      .values({ workspaceId: guestWorkspaceId, name: input.target.name, description: cleanDescription(input.target.description), ...(input.columns ?? {}) })
      .returning();
    await tx.insert(agentKeys).values({ agentId: agent!.id, tokenHash: sha256(input.apiKey), tokenPrefix: tokenPrefix(input.apiKey) });
    created = { agent: agent!, workspaceHandle: workspace!.handle! };
  }

  const share = await upsertShare(tx, {
    agentId: owner.id,
    guestWorkspaceId: guestWorkspaceId!,
    status: invite.approveOnRedeem ? 'approved' : 'pending',
    dailyCap: invite.dailyCap,
    inviteId: invite.id,
    label: input.label ?? invite.label,
  });
  await replaceShareOffers(tx, share.id, offerIds);

  const [bumped] = await tx
    .update(agentInvites)
    .set({ uses: sql`${agentInvites.uses} + 1` })
    .where(and(eq(agentInvites.id, invite.id), sql`${agentInvites.uses} < ${agentInvites.maxUses}`))
    .returning({ id: agentInvites.id });
  if (!bumped) throw REDEEM_ERRORS.exhausted;

  return { share: await shareCard(tx, share, owner), created: true, newWorkspace: created, apiKey: input.apiKey, claimToken: input.claimToken };
}

/** Same rule as inviteGuest: pending and approved shares use a slot. The guest gets the owner-plan message reworded. */
async function assertGuestSlot(tx: Db, owner: AgentRow) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(agentShares)
    .where(and(eq(agentShares.agentId, owner.id), inArray(agentShares.status, ['pending', 'approved'])));
  try {
    await assertGuestWorkspaceLimit(owner.workspaceId, Number(row?.count ?? 0), tx);
  } catch (err) {
    if (err instanceof PlanLimitError) {
      throw new PlanLimitError({ ...err.body, message: 'The owner\'s plan has no room for another guest. Ask them to upgrade or remove a guest.' });
    }
    throw err;
  }
}
```

`listInvites`, `revokeInvite`, `serializeInvite`, `previewInvite`, `upsertShare`, `shareCard` and `workspaceHandle` follow the same patterns as `listJoinCodes`, `revokeJoinCode`, `serializeShare` and `getAgentCard`. The sketch above omits them, and the types are loose where marked.

`shareCard` returns `{ address, status, daily_cap, offers: [{ name, description, result_schema }] }`. That is the same offer shape as `get_agent_card`, so the agent can act without a second call.

### 9.2 Changes to `lib/sharing.ts`

- Export `lockOwnerAgent`, `loadOffersByName`, `dedupeOfferNames`, `replaceShareOffers`. `assertDailyCap` is already exported.
- `listShares` and `serializeShare` add `label`, `invite_id`, and `invite_prefix` (via a left join on `agent_invites`).
- `inviteGuest` leaves `invite_id` and `label` as they are when it re-invites. Two places can grant the same guest, and the latest write wins for offers and cap, as today.

### 9.3 Changes to `lib/auth.ts` (phase 2)

`verifyLoginCode(email, code, opts?: { claimToken?: string })`. Inside the existing transaction, before the `if (!workspaceId)` branch:

```ts
if (opts?.claimToken) {
  if (row.workspaceId) throw new HttpError(409, 'already_in_workspace', 'This email already has a workspace. Use your agent\'s redeem_invite to add the share to it.');
  await tx.execute(sql`select id from workspaces where claim_token_hash = ${sha256(opts.claimToken)} for update`);
  const [claimed] = await tx
    .update(workspaces)
    .set({ claimTokenHash: null, claimedAt: new Date() })
    .where(and(eq(workspaces.claimTokenHash, sha256(opts.claimToken)), isNull(workspaces.claimedAt)))
    .returning();
  if (!claimed) throw new HttpError(404, 'claim_not_found', 'This claim link is not valid.');
  workspaceId = claimed.id;
  // fall through to the existing users.update(...) that sets workspaceId and email_verified_at
}
```

The `already_in_workspace` and `claim_not_found` checks must run **before** the login code is consumed, so a failed claim does not burn the code. Move the code-consume step after them, or do a pre-check outside the transaction and repeat it inside.

### 9.4 Unclaimed-workspace guard

```ts
// lib/invites.ts
export async function assertClaimed(tx: Db, workspaceId: string) {
  const [ws] = await tx.select({ origin: workspaces.origin, claimedAt: workspaces.claimedAt }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (ws?.origin === 'invite' && !ws.claimedAt) {
    throw new HttpError(403, 'claim_required', 'Claim this workspace before sharing its agents.');
  }
}
```

Call it from `setAgentShared(…, true)` and `createInvite`.

### 9.5 First-agent alert

`registerAgentWithJoinCode` sends a first-agent alert. Redeem does **not** call `queueFirstAgentAlert`. A redeemed guest is the owner's customer, not a new ReplySlip signup. Track invite redemptions in stats instead: count `workspaces.origin = 'invite'`.

## 10. Routes and pages

| File | Purpose |
| --- | --- |
| `app/api/v1/agents/[id]/invites/route.ts` | GET list, POST create (`requireHumanOwner`). |
| `app/api/v1/agents/[id]/invites/[inviteId]/revoke/route.ts` | POST revoke (`requireUser`). |
| `app/api/v1/invites/preview/route.ts` | GET preview (public, rsi bearer). |
| `app/api/v1/invites/redeem/route.ts` | POST redeem. |
| `app/api/v1/claims/preview/route.ts` | Phase 2. |
| `app/(site)/i/[token]/page.tsx` | Preview page, server-rendered. Calls `previewInvite` directly, never redeems. Sends `noindex` and `Referrer-Policy: no-referrer`. |
| `app/(site)/claim/[token]/page.tsx` | Phase 2. Email → code → verify with `claim_token`, then redirect to `/dashboard`. |

The redeem route shape:

```ts
const bodySchema = z.object({
  invite: z.string().startsWith('rsi_').max(200),
  name: z.string().optional(),
  description: z.string().max(2000).optional(),
  label: z.string().max(80).optional(),
  webhook: z.object({ url: z.string().min(1).max(2000), auth: webhookAuthSchema }).optional(),
});

export function POST(req: Request) {
  return handle(async () => {
    const body = parseBody(bodySchema, await readJson(req));
    const bearer = bearerToken(req);
    if (bearer) {
      const caller = bearer.startsWith('rsk_') ? await authenticateAgentKey(bearer) : null;
      if (!caller) throw new HttpError(401, 'unauthorized', 'Send an agent key, or no Authorization header.');
      if (body.name || body.description || body.webhook) {
        throw new HttpError(400, 'validation_error', 'name, description, and webhook are only for a new workspace.');
      }
      const out = await redeemInvite({ token: body.invite, label: body.label, target: { kind: 'existing', caller }, req });
      return json({ share: out.share, created: out.created }, out.created ? 201 : 200);
    }
    if (!body.name) throw new HttpError(400, 'validation_error', 'name is required.');
    const origin = requestOrigin(req);
    const out = await redeemInvite({
      token: body.invite,
      label: body.label,
      target: {
        kind: 'new',
        name: body.name,
        description: body.description,
        delivery: body.webhook ? { mode: 'webhook', url: body.webhook.url, auth: body.webhook.auth } : undefined,
      },
      req,
    });
    return json({ /* section 7.5 */ }, 201);
  });
}
```

## 11. Dashboard

`components/dashboard/Guests.tsx`:

- New "Invite links" section above the guest list: a create form (section 5.1) and a list with status chips and Revoke.
- After create, a one-time panel with the URL, the agent prompt, and `CopyButton`s. It says "This link is shown once."
- The guest row shows the `label` if set, else the handle, plus "via invite rsi_8hQx" when `invite_prefix` is set.
- If the agent isn't shared, the create form is disabled with "Turn on sharing first", like `SharingToggle`.

`components/dashboard/types.ts`: add `Invite`, and `label` and `invite_prefix` on `Share`.

## 12. Docs

- **`skill.md` (`lib/agent-docs.ts` `skillMarkdown`).** New section "Redeem an invite". If you have no ReplySlip key, `POST /api/v1/invites/redeem` with `invite` and `name`. Save `api_key`, add MCP, then call `get_agent_card` on `share.address`. If you already have a key, call `redeem_invite`. Mention the `claim_url` and tell the agent to pass it to its human, not to open it itself.
- **`docs/API.md`.** Add an "Invite links" section with sections 7.1–7.6 and the new MCP tools.
- **README.** One paragraph under sharing, and the tool list.
- **`app/(site)/sharing/`.** A short "Share with customers who aren't on ReplySlip" block.
- **Provisioning (5.7)** goes under `docs/API.md` → Invite links → "Provisioning from your backend".

## 13. Security and abuse

- **Tokens.** `rsi_` and `rsc_` are hashed at rest and shown once. An `rsi_` token is a bearer secret in a URL, so the preview page sends `Referrer-Policy: no-referrer` and `noindex`. Logs must not record the path; check Vercel log settings.
- **Approval.** Only a session can create an approving invite, and a DB check enforces it. Agent-created invites land pending.
- **Scope.** A redeemed share is exactly the invite's offers. `resolveSharedTask` already hides ungranted offers.
- **Volume.** Each redeem is rate-limited per IP. Uses are capped per invite (≤1000), active invites per agent (≤50), and guests by the owner's plan. Each share keeps its own daily cap. Guest task quota is charged to the guest workspace (`countTasksThisMonth` uses `from_workspace_id`), so each invite workspace has its own free 1000/month.
- **Anonymous workspaces** can't share agents or create invites until claimed. They have one agent and can't make join codes, because that needs a session.
- **Revocation.** Revoking an invite stops new redemptions. Revoking a share works as today and wakes guest senders with `access revoked`. Turning off sharing fails all guest tasks, including invite guests.
- **Untrusted text.** Guest task text is already marked untrusted (`GUEST_WAKE_NOTICE`, `CROSS_WORKSPACE_TASK_NOTICE`). Invite labels are owner text, shown only to the owner and the claimer.
- **Enumeration.** Preview returns one `404` for every invalid state. Redeem distinguishes revoked, expired and exhausted, but only for a token the caller already holds.

## 14. Tests (`tests/agent-invites.test.ts`)

- **Create.**
  - Session creates, and `approve_on_redeem` defaults to true.
  - An `rsk_` bearer on the REST route gets `403 human_required`.
  - The MCP `create_invite` result has `approve_on_redeem: false`.
  - An unshared agent gets `agent_not_shared`, and an unknown offer gets `offer_not_found`.
  - Expiry outside 1–90 days, max_uses outside 1–1000, and more than 50 active invites are all refused.
- **Redeem new.**
  - It creates a workspace (`origin = 'invite'`, `g-` handle), agent, key and share (`approved`, with the invite's offers and cap, `invite_id` and label).
  - The returned key works with MCP `get_agent_card` and `create_task` on `@owner/agent`.
  - The webhook stored at redeem is woken on `complete_task`.
- **Redeem existing.**
  - It creates the share in the caller's workspace.
  - A second call is idempotent (`created: false`, uses unchanged).
  - A revoked share is re-opened and consumes a use.
  - Using the owner's own workspace gives `invalid_guest`.
  - `name` or `webhook` with a bearer gives `400`.
- **Invite states.** Revoked, expired and exhausted each give `410` with their own code. An unknown token gives `404`. Concurrent redeems of a 1-use invite: exactly one succeeds.
- **Owner side.**
  - Unsharing the agent after create makes redeem return `agent_not_shared`.
  - Deleting every invite offer gives `invite_has_no_offers`.
  - The free guest limit hits `plan_limit` at redeem with the guest wording, and an unlimited owner is not limited.
- **Pending invites.** An agent-created invite gives a pending share and `get_agent_card` returns `share_pending`. After a human approves, it works.
- **Revoking.** Revoking the invite doesn't touch existing shares. Revoking a share redeemed from an invite fails open tasks with `access revoked`.
- **Guards.** An unclaimed invite workspace gets `claim_required` for `set_agent_sharing true` and `create_invite`. `set_workspace_handle` still works.
- **Preview.** It shows only granted offers, and every invalid state gives the same `404`.
- **Isolation.** The guest sees only its own tasks to the owner agent (extend `tests/isolation.test.ts`).
- **Claim (phase 2).**
  - A new email claims: the user is attached, `claimed_at` is set and the token cleared.
  - A second claim gives `claim_not_found`.
  - An email with a workspace gives `already_in_workspace`, and the code is not burned.
  - After claiming, `set_agent_sharing` works.
- **Docs.** `tests/docs.test.ts` covers the new tool names and skill.md section.

## 15. Rollout

| Phase | Scope | Ships |
| --- | --- | --- |
| 1 | Migration, `lib/invites.ts`, REST create/list/revoke/preview/redeem, MCP `create_invite`, `list_invites`, `revoke_invite`, `redeem_invite`, unclaimed guard, `/i/[token]` page, dashboard Invite links, skill.md and API docs, tests | ABC can onboard customer agents with one paste |
| 2 | Claim: `claim_token` on verify, `/claim/[token]`, claims preview, tests | Customers can get a dashboard later |
| 3 | Provisioning docs (5.7), with an example backend snippet | ABC can automate with no customer action |

For ABC specifically: the free plan allows 3 guests per shared agent, so ABC's workspace must be on `unlimited` (one `UPDATE workspaces SET plan = 'unlimited'`, as today) before phase 1 is useful to them.

## 16. Open questions

1. **Cleanup of unclaimed invite workspaces** with no tasks after N days. They cost nothing, but they inflate stats. Exclude `origin = 'invite'` from `admin-stats` signups?
2. **Should revoking an invite optionally revoke its shares?** A checkbox "also revoke the N guests who used this link" would be easy to add later, because `agent_shares.invite_id` exists.
3. **Key recovery for unclaimed workspaces.** Today a lost key means a new invite. Should redeem with the claim token also issue a fresh key, without a full claim?
4. **Pricing.** Should invite links be an unlimited-plan feature, since they mainly make sense with more than 3 guests?
5. **Token in the URL path vs fragment.** `/i/#rsi_…` keeps the token out of server logs, but needs client-side rendering of the preview. Decide before launch.
