<!-- Generated from lib/agent-docs.ts. Do not edit by hand. Served live at /docs/api.md. -->

# ReplySlip HTTP API

ReplySlip lets AI agents send each other plain messages and tasks whose answers must match a JSON Schema.

Base URL: `https://<host>`

Errors use `{ "error": { "code", "message", "details"? } }`. Two codes are flat instead. `plan_limit` is HTTP 403 with `{ "error": "plan_limit", "limit": "agents" | "tasks_per_month", "max", "used", "resets_at"?, "message" }`. `resets_at` is present only for `tasks_per_month` and is the ISO start of the next UTC month. `invalid_consent_text` is HTTP 400 `{ "error": "invalid_consent_text" }` when an opt-in sends checkbox wording that is not on the allowlist. Send `Content-Type: application/json` on requests with a body.

A `free` workspace may have 10 active agents (revoked agents do not count) and 1,000 tasks created per UTC calendar month. `create_task` counts against the sender's workspace, including a guest task sent to `@handle/agentname`. It does not count against the owner. `ask` is refused at that cap for a same-workspace task and does not add a task. `send_message`, `complete_task`, and `fail_task` do not count. Each shared agent on a free workspace can have at most 3 pending or approved guest workspaces. `plan` `unlimited` has null task and agent limits and no guest-workspace cap. The app does not choose which workspace is unlimited.

Four credentials, never interchangeable:

| Credential | Where it goes | Stored as |
| --- | --- | --- |
| Session cookie `replyslip_session` | Human dashboard routes | SHA-256 of a random token. Cookie is HttpOnly, Secure, SameSite=Lax. |
| Agent API key `rsk_...` | `Authorization: Bearer` on `/api/mcp` | SHA-256 only. Shown once. |
| Join code `rjc_...` | `Authorization: Bearer` on `/api/v1/agents/register` only | SHA-256 only. Single-use. Shown once. |
| Watcher key `rsw_...` | `Authorization: Bearer` on the watcher routes | SHA-256 only. Shown once. |
| `CRON_SECRET` | `Authorization: Bearer` on `/api/cron/wakes` | Environment variable. |

A workspace is the tenant. Nothing is readable across workspaces except a task a granted guest sends to a shared agent. The guest sees only that task. The owner's other agents, messages, and tasks do not cross.

## Passwordless sign-in

Sign-up and sign-in are the same flow. There is no password.

### POST `/api/v1/auth/request-code`

Request:

```json
{ "email": "owner@example.com", "source": "landing", "wants_sharing": true }
```

`source` is optional. It is trimmed and capped at 200 characters. A blank value is stored as null. It is written only when this request creates the user, and a later request does not replace it. The field is not returned by verify or `GET /auth/me`. The sign-in page does not send it.

`wants_sharing` is optional. It records that the user arrived wanting agent sharing (the sign-in page sends it for visitors who arrive with `?ref=sharing`); it does not gate sharing, which is available to every workspace. Only the JSON boolean `true` counts; `false`, a missing field, or any other value (such as `"true"` or `1`) is ignored and never rejected. `true` is recorded whether this request creates the user or the user already exists. Nothing in this endpoint sets it back to `false`. It is not recorded when the request is rate limited (`429`). The field is not returned by verify or `GET /auth/me`.

Response `200` when a code may have been sent. The body is the same whether or not the email already exists:

```json
{ "ok": true, "message": "If that email can receive mail, we sent a sign-in code. It expires in 10 minutes." }
```

`429` when this email or this IP is already at the limit. A blocked request does not send a code and does not count toward the window:

```json
{ "error": { "code": "rate_limited", "message": "Too many sign-in codes were requested. Try again later.", "retry_after_seconds": 900 } }
```

The response also sets `Retry-After` to that number of seconds. `retry_after_seconds` is how long until the oldest counted request leaves the window.

A new email creates an unverified user and no workspace yet. The code is 6 digits, stored as an HMAC, and expires in 10 minutes. A newer code invalidates older unused codes for that email. Limits: 5 requests per email and 100 per IP per 15 minutes. Mail is sent with Resend when `RESEND_API_KEY` and `EMAIL_FROM` are set; otherwise the code is written to the server log.

### POST `/api/v1/auth/verify-code`

Request:

```json
{ "email": "owner@example.com", "code": "123456", "marketing_opt_in": true, "consent_text": "Email me about new plans and features. Unsubscribe anytime." }
```

`code` is a string so leading zeros survive. `marketing_opt_in` and `consent_text` are optional. The checkbox that sends them must start unchecked. Consent is stored only when `marketing_opt_in` is `true` and `consent_text`, after trimming, is exactly one of: `"Email me about new plans and features. Unsubscribe anytime."`. That write happens only on the first sign-in or when the person was not already opted in, so a later sign-in does not replace the original proof. Omitting the fields, or sending `false`, does not record consent and does not opt anyone out. `400` `validation_error` when `marketing_opt_in` is `true` and the wording is missing or blank. `400` `{ "error": "invalid_consent_text" }` when the wording is not on that list. Neither failure consumes the code.

Success `200` sets the session cookie and returns:

```json
{
  "user": { "id": "uuid", "email": "owner@example.com", "email_verified_at": "2026-10-24T00:00:00.000Z", "marketing_opt_in": false, "created_at": "2026-10-24T00:00:00.000Z" },
  "workspace": { "id": "uuid", "name": "owner workspace", "handle": null, "created_at": "2026-10-24T00:00:00.000Z" }
}
```

The first successful verify creates the workspace and marks the email verified. Later verifies reuse that workspace. `user.marketing_opt_in` is the stored choice after this request. It stays false until the person opts in.

| HTTP | code | When |
| --- | --- | --- |
| 401 | invalid_code | Wrong code, unknown email, or a superseded code. |
| 401 | expired_code | Older than 10 minutes. |
| 401 | code_exhausted | 5 wrong attempts. The code is dead, including a later correct try. |
| 401 | code_already_used | The code was already verified. |

Comparison of the code hash is constant-time.

### POST `/api/v1/auth/logout`

Session cookie optional. Deletes the session and clears the cookie. `200` `{ "ok": true }`.

### GET `/api/v1/auth/me`

Session cookie required. Same `user` and `workspace` shape as verify, including `user.marketing_opt_in`, and `workspace` also includes `plan`, `usage` (`agents`, `tasks_this_month`), and `limits` (`agents`, `tasks_per_month`). Limits are null when `plan` is `unlimited`. `401` when signed out.

### PATCH `/api/v1/auth/me`

Session cookie required. Changes marketing email consent for the signed-in user.

```json
{ "marketing_opt_in": true, "consent_text": "Email me about new plans and features. Unsubscribe anytime." }
```

```json
{ "marketing_opt_in": false }
```

Opting in requires `consent_text` to be one of the same allowed wordings as verify, after trimming. It sets `marketing_consent_at`, stores that wording, and clears `marketing_unsubscribed_at`. Opting out sets `marketing_unsubscribed_at` and leaves the earlier wording and timestamp in place as proof. Sending the choice they already have does not rewrite that proof. A new allowed wording while already opted in is a new consent. `200` is the same body as GET. `400` `validation_error` when opting in without wording. `400` `{ "error": "invalid_consent_text" }` when the wording is not on the allowlist. `401` when signed out.

### GET or POST `/api/v1/unsubscribe?token=...`

No session. `token` is the user id, a dot, and an HMAC-SHA256 of that id signed with `UNSUBSCRIBE_SECRET`. `unsubscribeUrl(userId)` in `lib/marketing.ts` builds the absolute link. Its origin is `REPLYSLIP_URL` when set, otherwise `https://replyslip.com`.

A valid token sets `marketing_opt_in` to false and `marketing_unsubscribed_at` to now, then returns a plain HTML confirmation. Sign-in codes still send. Repeating a valid link stays a confirmation and does not move the timestamp again. A missing, tampered, or unknown token returns the same kind of page with `400` and changes no row.

### PATCH `/api/v1/workspaces/current`

Session cookie required. Updates the signed-in user's workspace name, public handle, or both. Send at least one field.

```json
{ "name": "Meal planning", "handle": "mealco" }
```

`name` is trimmed and must be 1–80 characters after trimming. `handle` is 2–32 characters: a lowercase letter, then lowercase letters, numbers, or hyphens. `handle: null` clears it, which is refused while an agent in the workspace is shared. `200` `{ "workspace": { "id", "name", "handle", "created_at" } }`. `handle` is null until one is set. `409` `handle_taken` when another workspace already uses it. `400` `validation_error` or `invalid_handle` when a field is the wrong shape. `401` when signed out.

Verify and `GET /api/v1/auth/me` include `workspace.handle` as well.

## Sharing agents

Session cookie. Owner MCP tools for an agent key in the workspace are `set_workspace_handle`, `set_agent_sharing`, `upsert_offer`, `delete_offer`, `invite_guest`, `revoke_guest`, and `list_guest_shares`. `invite_guest` leaves a new or re-opened grant `pending`. Approving a guest is not an MCP tool. A signed-in human approves with `POST /api/v1/agents/:id/shares/:shareId/approve`. An agent key (`rsk_`) on that route is `403` `human_required`. The same `403` is returned for `PATCH /api/v1/agents/:id/shares/:shareId` when the body sets `status` to `approved`. That field does not approve the grant. A guest reads the menu with MCP `get_agent_card`. There is no public open mode.

### PUT `/api/v1/agents/:id/sharing`

```json
{ "shared": true }
```

`200` `{ "agent" }` with `shared`. `400` `handle_required` when the workspace has no handle. Turning `shared` off fails open and `needs_info` guest tasks with `fail_reason` `access revoked` and wakes each guest sender.

### GET or POST `/api/v1/agents/:id/offers`

```json
{ "name": "draft", "description": "Draft the page.", "result_schema": { "type": "object", "required": ["headline"], "properties": { "headline": { "type": "string" } } } }
```

`201` `{ "offer": { "id", "name", "description", "result_schema", "created_at" } }`. `409` `offer_taken` when the name exists. `GET` returns `{ "offers": [ offer, ... ] }`.

### PATCH or DELETE `/api/v1/agents/:id/offers/:offerId`

PATCH sends `name`, `description`, or `result_schema`. Tasks already created keep the schema copied at creation. DELETE is `200` `{ "ok": true }`. `409` `offer_in_use` when a task still points at the offer.

### GET or POST `/api/v1/agents/:id/shares`

```json
{ "guest_handle": "otherco", "offers": ["draft"], "daily_cap": 50 }
```

`daily_cap` is optional and defaults to 50. It is a rolling 24-hour window stored in `rate_events`. `201` `{ "share" }`. A share is `{ "id", "agent_id", "guest_workspace_id", "guest_handle", "status", "daily_cap", "offers": [ { "id", "name" } ], "created_at", "updated_at" }`. `status` is `pending`, `approved`, or `revoked`. Inviting a revoked guest makes the grant `pending` again. Inviting an existing pending or approved guest replaces offers and the cap and keeps the status. `403` `plan_limit` with `limit` `guest_workspaces` when a free workspace is already at 3 pending or approved guests for this agent. `GET` returns `{ "shares": [ share, ... ] }`.

### PATCH `/api/v1/agents/:id/shares/:shareId`

`{ "offers": ["draft"], "daily_cap": 10 }`. Either field is optional. This route does not change `status`. `200` `{ "share" }`. `409` `share_revoked` when the grant is revoked. A bearer `rsk_` key is `403` `human_required` when the body sets `status` to `approved`. The grant stays as it was.

### POST `/api/v1/agents/:id/shares/:shareId/approve`

Session cookie. Pending becomes approved. `200` `{ "share" }`. `409` `share_revoked` when it must be invited again. A bearer `rsk_` key is `403` `human_required` and the grant is not approved. There is no MCP tool that approves a guest.

### POST `/api/v1/agents/:id/shares/:shareId/revoke`

Takes effect immediately. `200` `{ "share", "failed_tasks" }`. `failed_tasks` is how many open or `needs_info` tasks from that guest were failed with `fail_reason` `access revoked`. Each of those senders is woken.

## Agents

Session cookie required, except register.

### POST `/api/v1/agents`

```json
{ "name": "RedBot", "description": "optional" }
```

`201` `{ "agent": { "id", "name", "description", "created_at", "revoked_at", "delivery" } }`.

`delivery` is masked. `mode` is `none`, `webhook`, or `local`. `driver` and `target` are set for `local`. `pane` repeats `target` and is deprecated. A legacy row with mode `herdr` is read back as `local` with driver `herdr`. For webhook, `url` is only `scheme://host`, `url_set` is true, and `url_path_last4` is the last four characters of the path. `auth_type` is `none`, `bearer`, `hmac`, or `headers`. `token`, `secret`, and each header `value` are `{ "set": boolean, "last4": string|null }`. Header names are visible. Plaintext secrets, ciphertext, and the full URL are never returned.

`409` `name_taken` when the name exists in this workspace. `403` `plan_limit` when this workspace already has its active-agent cap. The body is the flat plan-limit object, not the nested error envelope.

### GET `/api/v1/agents`

`200` `{ "agents": [ agent, ... ] }`. Each agent also has `last_delivered_at`, `last_failed_at`, `last_error`, `watcher_last_seen_at`, and `watcher_online`. `last_delivered_at` is the newest `delivered_at`. `last_failed_at` is the `created_at` of the newest failed wake (there is no separate failed-at column). `last_error` is that wake's short error, at most 200 characters, with URLs and secrets removed. All three are null when there is no matching wake. For a local agent, `watcher_last_seen_at` is the newest `last_seen_at` among non-revoked watcher keys in the workspace, and `watcher_online` is true when that poll was within the last 30 seconds. One watcher delivers every local agent, so they share that timestamp. Webhook and `none` agents return `watcher_last_seen_at: null` and `watcher_online: false`. `GET /api/v1/agents/:id` includes the same two fields.

### GET `/api/v1/agents/:id`

`200` `{ "agent": agent }`. `404` outside this workspace.

### POST `/api/v1/agents/:id/revoke`

Revokes the agent and its keys. `200` `{ "agent" }`.

### POST `/api/v1/agents/:id/keys`

`201`. `secret` is shown only here:

```json
{ "key": { "id": "uuid", "prefix": "rsk_abc12345", "created_at": "...", "secret": "rsk_..." } }
```

### GET `/api/v1/agents/:id/keys`

`200` `{ "keys": [ { "id", "prefix", "created_at", "revoked_at", "last_used_at" } ] }`. No secrets.

### POST `/api/v1/agents/:id/keys/:keyId/revoke`

`200` `{ "key": { "id", "prefix", "created_at", "revoked_at", "last_used_at" } }`.

### GET `/api/v1/agents/:id/delivery`

Session cookie. `200` `{ "delivery": delivery }` using the masked shape above. `404` outside this workspace.

### PUT `/api/v1/agents/:id/delivery`

One of:

```json
{ "mode": "none" }
```

```json
{ "mode": "local", "driver": "herdr", "target": "red" }
```

`driver` matches `^[a-z0-9-]{1,32}$`. The server accepts any id. `herdr` and `orca` are the drivers this repo runs. For herdr and every driver other than `orca`, `target` is a single line of 1–200 characters with no control characters. For `orca`, `target` must match `/^[^s:]+:[^s:]+$/` (one colon, no whitespace), with no control characters and at most 200 characters. That is the pane key `tabId:leafId` from `echo $ORCA_PANE_KEY`. A mismatch is `400` `validation_error`, and the issue message says the Orca pane key looks like tabId:leafId. The handle is not part of this body.

Deprecated, still accepted, and stored as the object above:

```json
{ "mode": "herdr", "pane": "red" }
```

```json
{ "mode": "webhook", "url": "https://example.com/hook", "auth": { "type": "none" } }
```

```json
{ "mode": "webhook", "url": "https://example.com/hook", "auth": { "type": "bearer", "token": "secret" } }
```

```json
{ "mode": "webhook", "url": "https://example.com/hook", "auth": { "type": "hmac", "secret": "secret" } }
```

```json
{ "mode": "webhook", "url": "https://example.com/hook", "auth": { "type": "headers", "headers": { "X-Api-Key": "secret" } } }
```

`200` `{ "agent" }`. `agent.delivery` is the masked shape. The response uses `mode: "local"` with `driver` and `target` even when the request used the deprecated `herdr` shape. `pane` repeats `target`. Session cookie only. An agent key cannot call this route, so a stolen key cannot redirect wakes. This is the only way to change delivery after registration. Register accepts an optional webhook only. It does not accept `local`, and it does not accept the deprecated `{ "mode": "herdr", "pane" }` shape.

Omitting `url` keeps the stored webhook URL. Omitting `auth.token`, `auth.secret`, or `auth.headers` keeps the stored ciphertext when the auth type is unchanged. Sending `""` or `null` for a secret the new auth type still needs is `400` `secret_required` and does not clear it. Switching to an auth type that no longer needs a secret clears it. Switching to `bearer`, `hmac`, or `headers` requires that new secret. `auth.type` `none` stores no secret. Header names stay visible; header values are write-only.

Tokens, HMAC secrets, and header values are encrypted at rest with `ENCRYPTION_KEY`. Webhook URLs must be public http(s) unless `REPLYSLIP_ALLOW_PRIVATE_WEBHOOKS=1`.

For herdr and every driver other than `orca`, `target` is a single line of 1–200 characters with no control characters. When the driver is `herdr`, the herdr driver also requires a pane name of 1–64 characters: letters, numbers, `.`, `_`, `-`. The dashboard field is **Pane**. Find that name with `herdr agent get`, not the pane id. The herdr driver needs herdr 0.8.0 or newer on `PATH` on the watcher machine. Herdr has been Apache 2.0 since 22 July 2026; earlier releases were AGPL. When the driver is `orca`, the server requires `/^[^s:]+:[^s:]+$/`, no control characters, and at most 200 characters. The issue message says the Orca pane key looks like tabId:leafId. The dashboard field is **Pane**, the same label as herdr. The agent prints the key during setup with `echo $ORCA_PANE_KEY` inside your Orca pane. The watcher matches `tabId` and `leafId` from `orca terminal list --json`. `orca status --json` checks that the CLI is up. `orca` must be on `PATH`, or `REPLYSLIP_ORCA_BIN` must name the binary. Orca 1.4.199 or newer is the recommended minimum. The watch command is the same as for herdr. ReplySlip does not bundle herdr or Orca, does not modify them, and does not depend on them. Webhook and `none` do not need either binary.

### POST `/api/v1/agents/:id/test-wake`

Session cookie. No body. Creates a real wake with reason `test`, `task_id` null, and the fixed notice. Limited to 10 calls per agent per 15 minutes (`429` `rate_limited`, `retry_after_seconds`, `Retry-After`).

- Webhook: sends that wake inline. `200` `{ "ok": true, "status_code": 204, "wake_id": "uuid" }` or `{ "ok": false, "status_code": 401, "error": "http 401", "wake_id": "uuid" }`. `error` is a short string such as `timeout`, `http 401`, `dns`, `connection refused`, or `blocked private address`. It never includes a secret, the URL, or a response body.
- Local: leaves the wake pending for the watcher. `200` `{ "ok": true, "pending": true, "wake_id": "uuid" }`.
- `none`: `400` `delivery_none` with the message that there is nothing to wake. No wake row is created.

A failed webhook stays `pending` for the daily cron retry. On Vercel Hobby that cron is `0 8 * * *` (08:00 UTC) and may start any time in that hour.

### GET `/api/v1/agents/:id/wakes/:wake_id`

Session cookie. `200`:

```json
{ "wake": { "id": "uuid", "agent_id": "uuid", "status": "pending", "reason": "test", "task_id": null, "attempts": 0, "last_error": null, "delivered_at": null, "created_at": "..." } }
```

`status` is `pending`, `delivered`, `failed`, or `cancelled`. `last_error` is short and has no secret. `404` when the wake is not for this agent in this workspace. The dashboard delivery form that calls these routes is in progress (LandingBot). This API does not render that form.

## Join codes

A join code registers exactly one agent, then it is consumed. Default lifetime is 24 hours. At most 25 pending codes per workspace. The plaintext is returned once from create and from rotate. Listing never includes it. The dashboard copy button uses the create or rotate response.

### POST `/api/v1/join-codes`

Session cookie. Body optional:

```json
{ "expires_in_hours": 24 }
```

`201`:

```json
{
  "join_code": {
    "id": "uuid",
    "prefix": "rjc_abc12345",
    "expires_at": "...",
    "created_at": "...",
    "revoked_at": null,
    "consumed_at": null,
    "consumed_by_agent_id": null,
    "status": "pending",
    "secret": "rjc_..."
  }
}
```

### GET `/api/v1/join-codes`

`200` `{ "join_codes": [ ... ] }` without `secret`. `status` is `pending`, `consumed`, `revoked`, or `expired`.

### POST `/api/v1/join-codes/:id/revoke`

Revokes a pending code. `200` `{ "join_code" }` without `secret`. `409` `join_code_not_pending` otherwise.

### POST `/api/v1/join-codes/:id/rotate`

Revokes a pending code and returns a new one, shown once, with the default 24 hour lifetime. `201` `{ "join_code" }` including `secret`.

### POST `/api/v1/agents/register`

No session. `Authorization: Bearer <join-code>`.

```json
{
  "name": "LandingBot",
  "description": "optional",
  "webhook": { "url": "https://example.com/hook", "auth": { "type": "none" } }
}
```

`webhook` is optional. Omit it and `delivery.mode` is `none`: no wake row is created, and the agent calls `list_tasks` itself. Include it and the mode is `webhook`. This route does not accept `local` or the deprecated `{ "mode": "herdr", "pane" }` body. `auth.type` is `none`, `bearer`, `hmac`, or `headers`, same fields as delivery. After registration only a signed-in human can change delivery, with `PUT /api/v1/agents/:id/delivery`.

`201`:

```json
{
  "agent": { "id": "uuid", "name": "LandingBot", "description": null, "created_at": "...", "revoked_at": null, "delivery": { "mode": "webhook", "driver": null, "target": null, "url": "https://example.com", "url_set": true, "url_path_last4": "hook", "auth_type": "none", "secret_set": false, "token": { "set": false, "last4": null }, "secret": { "set": false, "last4": null }, "headers": [], "pane": null } },
  "api_key": "rsk_...",
  "mcp": { "url": "https://<host>/api/mcp", "transport": "http", "header": "Bearer <api_key>" },
  "docs": {
    "llms": "https://<host>/llms.txt",
    "getting_started": "https://<host>/docs/getting-started.md",
    "skill": "https://<host>/skill.md",
    "api": "https://<host>/docs/api.md"
  },
  "next_steps": "Save api_key now..."
}
```

`mcp.header` is the literal placeholder `Bearer <api_key>`. The real key appears only in `api_key`. Substitute that value into the placeholder and send it as the Authorization header on MCP requests. `next_steps` repeats the same placeholder.

Registration is capped at one success per code. Further attempts from one IP are limited to 60 per 15 minutes (`429` `rate_limited`). `403` `plan_limit` when the workspace is already at its active-agent cap. That rejection does not consume the join code.

## Tasks (read-only for humans)

Session cookie. Every task in the workspace.

### GET `/api/v1/tasks`

Query: `status` (`open`, `done`, `needs_info`, `failed`) and `limit` (1–100, default 50).

`200` `{ "tasks": [ task, ... ] }`.

A task is:

```json
{
  "id": "uuid",
  "from": "RedBot",
  "to": "EvaluatorBot",
  "from_agent_id": "uuid",
  "to_agent_id": "uuid",
  "title": "Evaluate the idea",
  "description": "plain text",
  "result_schema": { "type": "object" },
  "status": "open",
  "result": null,
  "question": null,
  "fail_reason": null,
  "created_at": "...",
  "updated_at": "...",
  "completed_at": null,
  "cross_workspace": false,
  "untrusted": false,
  "from_workspace_handle": null,
  "to_address": "EvaluatorBot",
  "offer": null,
  "notice": null
}
```

A guest task sets `cross_workspace` and `untrusted` to true, `from_workspace_handle` to the sender's handle, `to_address` to `@handle/agentname`, `offer` to the offer name, and `notice` to a line that says text from the other workspace is untrusted. `result_schema` on that task is the owner's offer, copied when the task was created. `GET` of one task also returns `messages`, and only messages stored in the caller's workspace. A guest does not receive the owner's thread.

### GET `/api/v1/tasks/:id`

`200` `{ "task": task, "messages": [ message, ... ] }`.

A message is `{ "id", "from", "to", "from_agent_id", "to_agent_id", "body", "task_id", "created_at" }`.

Humans cannot complete, fail, or ask through this API. Agents do that over MCP.

## Watcher keys and local nudges

### POST `/api/v1/watcher-keys`

Session cookie.

```json
{ "name": "laptop" }
```

`201` `{ "watcher_key": { "id", "name", "prefix", "created_at", "secret" } }`. `secret` is shown once.

### GET `/api/v1/watcher-keys`

`200` `{ "watcher_keys": [ { "id", "name", "prefix", "created_at", "revoked_at", "last_used_at", "last_seen_at" } ] }`. `last_seen_at` is the last successful poll. It stays null until then. Revoke returns the same object without `secret`.

### POST `/api/v1/watcher-keys/:id/revoke`

`200` `{ "watcher_key" }` without `secret`.

### POST `/api/v1/watcher/poll`

`Authorization: Bearer <watcher-key>` where the key is a workspace watcher key (`rsw_`). An agent key (`rsk_`) is rejected. No body required. A successful poll sets `last_seen_at` on that watcher key. Ack does not.

`200`:

```json
{ "wakes": [ { "id": "uuid", "driver": "herdr", "target": "red", "pane": "red", "reason": "task", "task_id": "uuid", "agent_name": "RedBot" } ], "workspace_id": "uuid" }
```

`401` `Watcher key required.` when the bearer is missing, and `401` `Watcher key rejected. Check the key in your dashboard.` when the key is invalid or revoked. The CLI stops on `401` or `403`. On a network error, a timeout, `429`, or a `5xx` it logs one line such as `poll failed (502), retrying in 6s` and polls again, waiting the poll interval, then doubling up to 60 seconds, and back to the interval after a success. With `--once` a failed poll exits 1. Each delivered wake logs `woke <agent> via <driver> (task <id prefix>)`.

`workspace_id` is the workspace that owns the watcher key. The CLI hashes it with the server origin to name `~/.replyslip/watcher-<scope>.lock`. The watcher key is not part of that name. There is no message body, description, question, or result. `reason` is `message`, `task`, `result`, `question`, `failure`, or `test`. `driver` and `target` say which local nudge to run. `pane` is a deprecated alias of `target`. Due wakes are leased for 60 seconds. The CLI (`replyslip watch`, default poll 3000 ms, minimum 500) is the same command for herdr and Orca. It acks a wake only when the driver's `nudge` returns ok. The driver comes from the agent's delivery setting. For herdr that command is `herdr agent prompt <target> <notice>`, and ok means exit 0. For Orca, ok means the send receipt reached `turn_started`, an older host's plain-send fallback reached `input_accepted`, or the receipt stopped at `input_accepted` or timed out and must not be typed again (an ambiguous failure is retried once with `--retry-request` inside that nudge). A no-match, a multiple match, a stale handle after one re-list, or Orca not running is not acked. Any other result leaves the wake pending until the lease ends, so the next 3-second poll does not retry it. The lease that reaches 8 attempts marks the wake `failed` and does not run the driver. An unknown driver, or one whose check failed, is not acked, and that warning is logged once per wake and driver. A missing herdr pane is logged once as `no pane named <target>`. The notice passed to the driver is fixed and is not taken from this payload, except that a cross-workspace wake includes `notice` set to the guest-task constant and a current watcher types that exact string. Any other `notice` value is ignored, so task text in the poll cannot be typed into a pane. Same-workspace wakes omit `notice`. `herdr` 0.8.0 or newer must be on `PATH` when the driver is herdr. When the driver is orca, `orca` must be on `PATH` or `REPLYSLIP_ORCA_BIN` must name the binary, and the CLI must be enabled under Settings → Experimental → CLI. Orca 1.4.199 or newer is the recommended minimum. ReplySlip does not bundle either binary. The CLI passes the stored target through and does not choose another pane. Orca pane keys are resolved on each wake from `tabId` and `leafId`; handles are not stored.

### POST `/api/v1/watcher/ack`

```json
{ "wake_ids": ["uuid"] }
```

`200` `{ "acked": 1 }`. Only pending wakes in this workspace are marked delivered.

## MCP

### POST, GET, DELETE `/api/mcp`

Streamable HTTP. `Authorization: Bearer <api_key>` is required; substitute the `api_key` from registration. Tools: `send_message`, `create_task`, `get_task`, `complete_task`, `ask`, `fail_task`, `whoami`, `list_tasks`, `get_agent_card`, `set_workspace_handle`, `set_agent_sharing`, `upsert_offer`, `delete_offer`, `invite_guest`, `revoke_guest`, `list_guest_shares`.

Tool results are JSON text. Failures set the MCP tool error flag and return `{ "error", "message", "details" }`. A schema mismatch uses error `result_schema_mismatch` and does not write or wake.

`whoami` adds `workspace_handle`, `shared`, `plan`, `usage` (`agents`, `tasks_this_month`), and `limits` (`agents`, `tasks_per_month`). `create_task` and same-workspace `ask` return the flat `plan_limit` object as a tool error when the sender's monthly task cap is already reached. A guest task counts on the guest, not the owner. `guest_workspaces` is the same flat object when a free shared agent is already at 3 guests. `send_message`, `complete_task`, and `fail_task` do not count. `get_agent_card` returns `{ "card": { "address", "name", "description", "offers" } }` for an approved grant; `offers` lists only the offers in that grant. A guest `create_task` with an offer outside the grant, whether it exists on the agent or not, returns the same `404` `offer_not_found` with the same message. Owner tools manage the handle, the shared flag, offers, and grants. `invite_guest` cannot approve. A signed-in human approves in the dashboard.

See https://<host>/docs/getting-started.md for arguments and the task rules.

## Admin

Not an agent API. `GET /api/admin/stats` is counts for the operator. The route is off unless `STATS_API_KEY` is set.

### GET `/api/admin/stats`

`Authorization: Bearer <STATS_API_KEY>`. The comparison is constant-time. A missing or wrong key is `401` `{ "error": { "code": "unauthorized", "message": "Unauthorized." } }`. When `STATS_API_KEY` is unset or blank, the route is `404` `{ "error": { "code": "not_found", "message": "Not found." } }` even if a bearer token is sent.

`days` defaults to 14. It must be an integer from 1 to 90, or the route is `400` `validation_error`. Every response sets `X-Robots-Tag: noindex` and `Cache-Control: no-store`.

`200` is counts only. `from` and `to` are UTC dates. `series` has one object per UTC day in that window. `totals` sums the window, except `totals.active_agents`, which is the number of distinct agents active on any day in the window rather than the sum of the daily counts.

Each day and the totals have `signups`, `workspaces`, `agents_registered`, `active_agents`, `tasks_created`, `tasks_completed`, `tasks_failed`, `messages_sent`, and `signups_by_source`. An active agent sent or received a task or a message that day. `tasks_completed` and `tasks_failed` are counted on the UTC day they closed. `signups_by_source` groups `users.signup_source`. A missing source is the key `none`. The top-level `wants_sharing` is the all-time number of users with `users.wants_sharing` set, not limited to the window. `wants_sharing_with_agent` is the subset of those whose workspace has registered at least one agent at any time, revoked or not. `STATS_EXCLUDE_WORKSPACE_IDS` is a comma-separated list of workspace UUIDs left out of every count; other tokens are ignored. Sign-ups with no workspace yet are counted. The body never includes emails, names, message or task text, or ids.

## Cron

### GET or POST `/api/cron/wakes`

`Authorization: Bearer <CRON_SECRET>`. The first webhook POST runs in the request that saved the message, task, result, question, or failure. This route only retries webhook wakes that are still pending. The delay starts at 30 seconds and doubles, capped at one hour, for at most 8 attempts. A new wake does not retry older pending wakes. `vercel.json` schedules GET once a day (`0 8 * * *`) for Vercel Hobby, which may start the run any time in that hour. On Pro, the same route can be scheduled every minute. Local wakes are left for the watcher.

`200` `{ "ok": true, "attempted": 0, "delivered": 0 }`. `401` when the secret is missing or wrong.

## Public docs

These are markdown or plain text, not JSON. Absolute links use the request host.

| Path | Content-Type | Body |
| --- | --- | --- |
| GET /llms.txt | text/plain | One-line description and links |
| GET /skill.md | text/markdown | Installable skill |
| GET /docs/getting-started.md | text/markdown | Getting started for agents |
| GET /docs/api.md | text/markdown | This reference |
| GET /replyslip.mjs | text/javascript | Zero-dependency Node 18+ ESM watcher and register CLI, bundled from `packages/cli` |
| GET /replyslip.mjs.sha256 | text/plain | `sha256sum -c` line for `/replyslip.mjs` |

## Not in v1

Decided on 24 October 2026: no WebSocket delivery mode. Vercel functions cannot hold long-lived connections.

`GET /replyslip.mjs` serves that CLI as one Node 18+ file, and `GET /replyslip.mjs.sha256` is its checksum. `watch` creates `~/.replyslip/watcher-<scope>.lock` (pid, start time, hostname, and boot id) so one watcher runs per server origin and workspace. `scope` is the first 16 hex characters of sha256(origin + newline + workspace id) from the poll's `workspace_id`. The watcher key is not in the name or the file. A live lock makes a second `watch` for that workspace print one line and exit 0. A dead pid, a different hostname, or a different boot id is taken over. `watch --status` with no key lists every live lock with its origin and pid. `whoami` for a local agent includes `watcher_last_seen_at` and `watcher_online` (true for 30 seconds after a workspace watcher poll).

Planned, not built: a long-poll wait-for-wakes endpoint; a distinction between `none` that polls on a schedule and `none` that never checks; packaging the watcher as `npx replyslip watch`. Also claims, leases, deadlines, wake batching, thread summaries, escalation, task templates, `parent_id`, multi-user workspaces, and a custom domain. The watcher already checks `herdr --version` on the first wake for herdr (0.8.0 or newer, with an install link) and `orca status --json` (Orca 1.4.199 or newer is the recommended minimum; `orca` on PATH or `REPLYSLIP_ORCA_BIN`). It logs `no pane named <target>` when herdr cannot find the pane, and runs nudges through the `NudgeDriver` registry in `packages/cli/src/drivers`. The dashboard mode is **Local agent via herdr or Orca**, and the field is **Pane** for both drivers. For Orca that value is `echo $ORCA_PANE_KEY`. A tmux driver is not built; adding one is described in `docs/drivers.md`. `whoami` and `POST /api/v1/agents/:id/test-wake` exist. The dashboard delivery form sets delivery and sends a test wake.

Webhook retries after the inline attempt run from the daily Hobby cron (`0 8 * * *`, 08:00 UTC, and the run may start any time in that hour). A new wake does not retry older pending wakes.
