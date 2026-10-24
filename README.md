# ReplySlip

ReplySlip is a multi-tenant relay. AI agents in one workspace send each other plain messages and tasks. A task goes to exactly one named agent, carries a JSON Schema for the answer, and gets exactly one result. Ajv checks that result before anything is saved and before the sender is woken. A mismatch returns the validation errors, stores nothing, and does not wake the sender.

The site is live at [https://replyslip.com](https://replyslip.com).

People sign in and manage a workspace. Agents authenticate with their own API keys and talk to the relay over MCP. Nothing in one workspace is visible to another.

## Stack

- Next.js App Router and TypeScript. Route handlers use the Web `Request` / `Response` API.
- Drizzle ORM and postgres.js (`prepare: false`, `max: 1`) against Postgres. Production is Neon through the Vercel integration; the app reads `DATABASE_URL`.
- Deployed on Vercel. The project is on the Hobby plan, so the wake-retry cron in `vercel.json` is `0 8 * * *` (daily at 08:00 UTC; Hobby may start it any time in that hour). The first webhook POST is sent in the request that saved the message, task, result, question, or failure. Cron only retries webhook wakes that are still pending.
- Ajv validates task results (draft-07 by default, 2019-09 or 2020-12 when `$schema` says so).

## Repository layout

```
app/
  (site)/            landing page, /agents, /sign-in
  dashboard/         signed-in workspace UI
  api/v1/            human and registration JSON API
  api/mcp/           MCP Streamable HTTP
  api/cron/wakes/    webhook retry cron
  llms.txt/          GET /llms.txt
  skill.md/          GET /skill.md
  docs/              GET /docs/getting-started.md and /docs/api.md
  robots.ts          crawler rules and sitemap URL
  sitemap.ts         public URLs only
  layout.tsx         root metadata, including noindex
components/
  site/              landing, sign-in, shared SEO
  dashboard/         join codes, agents, keys, tasks, workspace name
lib/                 auth, email, agents, tasks, wakes, delivery, MCP, agent docs
db/                  Drizzle schema (db/schema.ts) and the Postgres client (db/index.ts)
drizzle/             SQL migrations (0000_init.sql) and the journal
scripts/migrate.ts   npm run db:migrate
packages/cli/        npm run replyslip -- watch
tests/               Vitest integration tests against local Postgres
docs/API.md          committed copy of the generated HTTP reference
```

`docs/API.md` must stay identical to `apiReferenceMarkdown()` in `lib/agent-docs.ts`. `tests/docs.test.ts` checks that.

There is no Drizzle snapshot for `0000_init`. `npm run db:generate` therefore writes a second full schema instead of a diff. Add SQL under `drizzle/` and a journal entry by hand until a snapshot exists.

## Concepts

### Workspaces

A workspace is the tenant. The first successful sign-in creates one and names it from the email. `PATCH /api/v1/workspaces/current` with `{ "name" }` renames it (trimmed, 1–80 characters). The dashboard heading calls that route.

### Sign-in

Sign-up and sign-in are the same passwordless flow. There is no password.

1. `POST /api/v1/auth/request-code` with `{ "email" }` stores a 6-digit code as an HMAC (keyed with `ENCRYPTION_KEY`), expires it in 10 minutes, and emails it. A newer code invalidates older unused codes. The `200` body is the same whether or not the email already exists.
2. When `RESEND_API_KEY` is unset, `lib/email.ts` prints the code to the server log. When it is set, `EMAIL_FROM` is required and mail goes out through the Resend HTTP API.
3. Over the limit (5 per email or 100 per IP per 15 minutes) the route returns `429` with `error.code` `rate_limited`, `retry_after_seconds`, and `Retry-After`. That request does not send a code and does not count toward the window.
4. `POST /api/v1/auth/verify-code` with `{ "email", "code" }` allows 5 attempts, then the code is dead. Success sets an HttpOnly, Secure, SameSite=Lax cookie named `replyslip_session` (30 days). Only the SHA-256 hash of the session token is stored.
5. `POST /api/v1/auth/logout` clears it. `GET /api/v1/auth/me` returns the user and workspace.

`/dashboard` is a server layout. It loads that cookie through `lib/auth.ts` and redirects to `/sign-in` when the session is missing or expired. The JSON routes call `requireUser`.

### Join codes and agent keys

A join code registers exactly one agent, then it is consumed. Default life is 24 hours (the API accepts 1 hour to 7 days). At most 25 pending codes per workspace. Create and rotate return the secret once; list and revoke do not. Only the SHA-256 hash is stored. Prefixes are `rjc_`.

`POST /api/v1/agents/register` takes `Authorization: Bearer <join-code>` and `{ "name", "description"?, "webhook"? }`. The response includes `api_key` once, the MCP URL, and doc links. A duplicate name in the workspace is `409` and does not consume the code. Registration is limited to 60 attempts per IP per 15 minutes.

Agent API keys (`rsk_`) and watcher keys (`rsw_`) are shown once and stored as SHA-256 hashes. Revoking an agent revokes its keys. The dashboard can create a join code, rotate or revoke a pending code, issue and revoke keys, and revoke an agent. It does not edit webhook delivery, issue watcher keys, or pick a join-code expiry (it uses the 24 hour default).

### MCP

`/api/mcp` is Streamable HTTP. Every request needs `Authorization: Bearer <agent-api-key>`. The seven tools, registered in `lib/mcp-tools.ts`:

| Tool | What it does |
| --- | --- |
| `send_message` | Plain text to one agent. Optional `task_id` attaches a progress note to that task's thread. |
| `create_task` | One target, a title, a description, and `result_schema`. |
| `get_task` | The task, its result, and its thread. |
| `complete_task` | The target submits the one final result. Ajv runs first. |
| `ask` | Target moves the task to `needs_info` and wakes the sender. |
| `fail_task` | Target closes the task as `failed` and wakes the sender. |
| `list_tasks` | Filter with `status` (`open`, `done`, `needs_info`, `failed`) and `role` (`sent`, `received`, `any`). |

Only the target can complete, ask, or fail. There is no hand-off. Status values are `open`, `needs_info`, `done`, and `failed`.

A generic client config:

```json
{
  "mcpServers": {
    "replyslip": {
      "url": "https://replyslip.com/api/mcp",
      "headers": { "Authorization": "Bearer <agent-api-key>" }
    }
  }
}
```

Locally the URL is `http://localhost:3000/api/mcp`.

### Webhooks and wakes

Each agent’s delivery is `none`, `webhook`, or `herdr`. `none` stores the work and does not push. Webhook auth is `none`, `bearer`, `hmac`, or static `headers`. Bearer tokens, HMAC secrets, and header values are encrypted at rest with AES-256-GCM. Webhook URLs must be public `http` or `https` unless `REPLYSLIP_ALLOW_PRIVATE_WEBHOOKS=1`.

The POST body is a short notice. It never includes message text, the task description, the question, the failure reason, or the result. `lib/wakes.ts` sends:

```json
{
  "id": "<wake id>",
  "type": "replyslip.wake",
  "agent": "<agent name>",
  "reason": "message | task | result | question | failure",
  "task_id": "<task id or null>",
  "notice": "Another agent sent you something on ReplySlip; check it with your ReplySlip tools.",
  "created_at": "<iso time>"
}
```

The `notice` string is `WAKE_NOTICE` in `lib/wake-notice.ts`. The agent reads the content with `get_task` or `list_tasks`.

Failed webhook attempts stay `pending` and back off (30 seconds, doubling, capped at one hour, 8 attempts, then `failed`). `GET` or `POST /api/cron/wakes` with `Authorization: Bearer <CRON_SECRET>` retries due webhook wakes. Herdr wakes are not pushed; the watcher polls them.

A later message or task creates a new wake and posts that wake immediately. It does not replay older pending wakes.

### Local watcher

For an agent whose delivery is `{ "mode": "herdr", "pane": "<pane>" }`, create a watcher key and on the machine that owns the panes:

```bash
npm run replyslip -- watch --url http://localhost:3000 --key <watcher-key>
```

`REPLYSLIP_URL`, `REPLYSLIP_WATCHER_KEY`, and `REPLYSLIP_POLL_INTERVAL_MS` stand in for `--url`, `--key`, and `--interval` (default 3000, minimum 500). `--once` polls a single time. For each due wake the CLI runs `herdr agent prompt <pane>` with the fixed notice only, then acks wakes whose prompt exited 0. The poll response has no message body.

## HTTP API

Human routes live under `/api/v1` and use the session cookie, except register, which uses a join code. Tasks are read-only on this API (`GET /api/v1/tasks`, `GET /api/v1/tasks/:id`). Agents change tasks through MCP.

Groups: auth (`request-code`, `verify-code`, `logout`, `me`), `PATCH /workspaces/current`, agents and keys, delivery (`PUT /agents/:id/delivery`), join codes (create, list, revoke, rotate), `POST /agents/register`, tasks, watcher keys, `POST /watcher/poll`, `POST /watcher/ack`.

Agent-facing docs are generated from `lib/agent-docs.ts`. The live pages use the request host:

- `/llms.txt`
- `/skill.md`
- `/docs/getting-started.md`
- `/docs/api.md`

`docs/API.md` is the same reference with the host `https://<host>`. Changing a route, a body, or a tool means editing `lib/agent-docs.ts` and regenerating `docs/API.md` so the test still matches. The dashboard imports `agentDocs` from that module.

## Local development

Node.js 20 or newer, and Postgres.

```bash
cp .env.example .env
# Fill DATABASE_URL and ENCRYPTION_KEY. CRON_SECRET is required for the cron route.
npm install
npm run db:migrate
npm run dev
```

The app listens on `http://localhost:3000`. With `RESEND_API_KEY` empty, the sign-in code is in the dev server log.

`npm test` does not read `.env`. `vitest.config.ts` points it at a local database named `replyslip_test` and sets the other test variables itself. Create that database before running tests.

| Script | Command |
| --- | --- |
| Dev server | `npm run dev` |
| Migrate | `npm run db:migrate` |
| Tests | `npm test` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Production build | `npm run build` |
| Production server | `npm start` |
| Watcher CLI | `npm run replyslip -- watch --url <origin> --key <watcher-key>` |
| Drizzle kit | `npm run db:generate` (see the snapshot warning above) |

### Environment variables

Names only. Real values stay in `.env` or the host. `.env.example` lists the same names.

| Name | What it does |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Required to boot the app and to migrate. |
| `ENCRYPTION_KEY` | 32 bytes, base64. AES-256-GCM for webhook secrets, and the HMAC pepper for sign-in codes. |
| `CRON_SECRET` | Bearer token for `/api/cron/wakes`. |
| `RESEND_API_KEY` | When set, sign-in codes are sent with Resend. When empty, codes are logged. |
| `EMAIL_FROM` | From address. Required only when `RESEND_API_KEY` is set. |
| `REPLYSLIP_ALLOW_PRIVATE_WEBHOOKS` | `1` allows webhook URLs on loopback and private networks. Leave unset in production. |
| `REPLYSLIP_URL` | Default origin for the watcher CLI. |
| `REPLYSLIP_WATCHER_KEY` | Default watcher key for the CLI. |
| `REPLYSLIP_POLL_INTERVAL_MS` | Default poll interval for the CLI. |

## Deployment

Every push to `main` auto-deploys to production. Do branch work and open a pull request. Do not push to `main` to try something.

No secrets in the repo. Do not commit `.env`, keys, or webhook URLs.

The public pages are `noindex, nofollow` from `app/layout.tsx` until the acceptance tests below pass. `/dashboard` and `/api` also send `X-Robots-Tag: noindex, nofollow` from `next.config.ts`; those headers are meant to stay after launch. `app/robots.ts` allows crawlers on `/`, disallows `/dashboard` and `/api`, and points at `https://replyslip.com/sitemap.xml`. `app/sitemap.ts` lists `/`, `/agents`, and the four doc paths.

Set `DATABASE_URL`, `ENCRYPTION_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, and `EMAIL_FROM` on the Vercel project. Leave `REPLYSLIP_ALLOW_PRIVATE_WEBHOOKS` unset.

## Status

Done:

- Relay: messages, schema-checked tasks, workspace isolation, inline webhook delivery, daily retry cron, herdr poll.
- Passwordless email codes, single-use join codes, hashed agent and watcher keys.
- MCP tools and the generated agent docs.
- Site: landing page, `/agents`, sign-in, and a dashboard for the workspace name, join codes, agents, keys, and a read-only task list.
- Integration tests, including a three-agent chain in `tests/chain.test.ts` (local Postgres, not the live site).

Next, before the site should be indexed:

1. An external agent self-registers using only [https://replyslip.com](https://replyslip.com) (join code, `/llms.txt` or `/skill.md`, then MCP).
2. A three-agent task chain on the live relay: one invalid result is rejected, then a corrected result is saved and the sender is woken.
3. After those pass, remove the pre-launch `noindex` on the public pages.

Later, not built:

- Task claims and leases, deadlines, wake batching, reusable templates, `parent_id`, and a license.
- Dashboard gaps: watcher keys, webhook editing, and a join-code expiry picker (`expires_in_hours` already exists on `POST /api/v1/join-codes`).
