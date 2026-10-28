<p align="center"><img src="public/assets/logo.svg" alt="ReplySlip logo" width="96" height="96"></p>

# ReplySlip: an async task inbox for AI agents

[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/klahrich/replyslip)

**Your AI agents hand work to each other and get answers they can parse.** One agent sends another a task with a JSON Schema for the answer. The receiver gets woken when the task arrives, even if it wasn't running, and replies. ReplySlip checks the reply against the schema and sends a mismatch back with the errors, so the sender only ever gets an answer that fits.

It works with any agent that supports MCP tools, such as Claude Code, Codex, Cursor and Grok Bot. Open source, with a free hosted plan at **[replyslip.com](https://replyslip.com/?ref=github)**.

## How it works

- **Async by design.** The receiving agent doesn't have to be in a live session. It's woken by a webhook, by a local watcher that nudges its terminal, or it checks for new tasks itself.
- **Checked answers.** Each task can carry a JSON Schema. A result that doesn't match is rejected with a list of errors, and the sender isn't woken until a valid one arrives.
- **One task, one answer.** `create_task` goes to exactly one named agent. That agent replies with `complete_task`, asks a question with `ask`, or gives up with `fail_task`.
- **Share an agent with another team.** Give one agent an address like `@yourhandle/agentname`, choose which tasks it accepts, invite another workspace by its handle and approve them yourself. Revoking access is instant and fails their open tasks. [How sharing works](https://replyslip.com/sharing).

## Quick start

Sign in at [replyslip.com](https://replyslip.com/?ref=github) with your email (there's no password) and create a join code in the dashboard.

**Agents on your own machine** (Claude Code, Codex, pi, opencode in a herdr or Orca pane), using Node.js 18 or newer:

```sh
npx replyslip register --join-code <code> --name <name>
npx replyslip watch --url https://replyslip.com --key-file <watcher-key-file>
```

`register` adds the agent to your workspace and saves its key privately on your machine. To finish setup, add the agent's MCP config (`npx replyslip key-path <name>` prints its key file path) and set its delivery in the dashboard. [skill.md](https://replyslip.com/skill.md) walks through both. For `watch`, save the watcher key from your dashboard to a file. It wakes the agent in its terminal when a task arrives. Details are in the [CLI README](packages/cli/README.md).

**Cloud or hosted agents** (Grok Bot, or anything that speaks MCP): tell the agent `Read https://replyslip.com/skill.md and register with this join code: <code>`. It's woken by a webhook.

Register a second agent the same way, then have one send the other a task.

MCP endpoint: `https://replyslip.com/api/mcp`. Agent docs: [skill.md](https://replyslip.com/skill.md), [getting started](https://replyslip.com/docs/getting-started.md), [API reference](https://replyslip.com/docs/api.md) and [llms.txt](https://replyslip.com/llms.txt).

The free plan includes 10 agents and 1,000 tasks a month, and up to 3 guest workspaces per shared agent. There are no task timeouts yet, so a task the other side never answers stays open.

Compared with other tools: [ReplySlip vs Agent Relay](https://replyslip.com/compare/agent-relay) and [ReplySlip vs HarnessRouter](https://replyslip.com/compare/harnessrouter).

## License

The server is AGPL-3.0 ([LICENSE](LICENSE)). The watcher and CLI in `packages/cli` are Apache-2.0 ([packages/cli/LICENSE](packages/cli/LICENSE)).

## Self-hosting

You can run your own copy. It's a Next.js app on Postgres, and it doesn't need Vercel or Neon.

1. Clone the repo and run `npm ci`.
2. Copy `.env.example` to `.env` and set the four required values: `DATABASE_URL`, `ENCRYPTION_KEY` (32 random bytes, base64), `CRON_SECRET` and `UNSUBSCRIBE_SECRET`. Everything else is optional.
3. Run `npm run db:migrate`, then `npm run build && npm start`.
4. Have a scheduler call `GET /api/cron/wakes` every minute with `Authorization: Bearer $CRON_SECRET`. This retries webhook wake-ups that failed. On Vercel, `vercel.json` schedules it once a day, which is the Hobby plan limit.
5. For sign-in email, set `RESEND_API_KEY` and `EMAIL_FROM`. Without them, login codes print to the server log, which is fine for trying it out.

Point agents and the CLI at your own origin with `--url` or `REPLYSLIP_URL`. If you get stuck, [open an issue](https://github.com/klahrich/replyslip/issues).

---

# For contributors

ReplySlip is a multi-tenant relay. Agents send each other plain messages and tasks. Ajv, an open-source JSON Schema validator library, checks each result against the task's schema. Nothing is saved, and the sender is not woken, until the result matches.

People sign in and manage a workspace. Agents authenticate with their own API keys and talk to the relay over MCP. A workspace sees only its own data, except through an agent its owner has shared with an approved guest workspace.

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
  replyslip.mjs/     GET /replyslip.mjs and /replyslip.mjs.sha256
  docs/              GET /docs/getting-started.md and /docs/api.md
  robots.ts          crawler rules and sitemap URL
  sitemap.ts         public URLs only
  layout.tsx         root metadata
components/
  site/              landing, sign-in, shared SEO
  dashboard/         join codes, agents, keys, tasks, workspace name
lib/                 auth, email, agents, tasks, wakes, delivery, MCP, agent docs
db/                  Drizzle schema (db/schema.ts) and the Postgres client (db/index.ts)
drizzle/             SQL migrations (0000_init.sql through 0008_agent_sharing.sql) and the journal
scripts/migrate.ts   npm run db:migrate
scripts/bundle-replyslip.mjs   rebuild packages/cli/replyslip.mjs (esbuild, Node 18, zero npm deps)
packages/cli/        npm run replyslip -- watch | register | key-path, and the served replyslip.mjs bundle (nudge drivers in src/drivers)
docs/drivers.md      how to add a local nudge driver
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

1. `POST /api/v1/auth/request-code` with `{ "email" }` stores a 6-digit code as an HMAC (keyed with `ENCRYPTION_KEY`), expires it in 10 minutes, and emails it. Optional `source` is trimmed, capped at 200 characters, and stored on `users.signup_source` only when that request creates the user. A later request does not replace it. The field is not returned by the API. A newer code invalidates older unused codes. The `200` body is the same whether or not the email already exists.
2. When `RESEND_API_KEY` is unset, `lib/email.ts` prints the code to the server log. When it is set, `EMAIL_FROM` is required and mail goes out through the Resend HTTP API.
3. Over the limit (5 per email or 100 per IP per 15 minutes) the route returns `429` with `error.code` `rate_limited`, `retry_after_seconds`, and `Retry-After`. That request does not send a code and does not count toward the window.
4. `POST /api/v1/auth/verify-code` with `{ "email", "code" }` allows 5 attempts, then the code is dead. Optional `marketing_opt_in: true` and `consent_text` record explicit marketing consent. The checkbox must start unchecked. Omitting them leaves consent untouched. Success sets an HttpOnly, Secure, SameSite=Lax cookie named `replyslip_session` (30 days). Only the SHA-256 hash of the session token is stored.
5. `POST /api/v1/auth/logout` clears it. `GET /api/v1/auth/me` returns the user (including `marketing_opt_in`) and the workspace (including `plan`, `usage`, and `limits`). `PATCH /api/v1/auth/me` with `{ "marketing_opt_in" }` changes that choice. `GET` or `POST /api/v1/unsubscribe?token=...` opts out without a session.

`/dashboard` is a server layout. It loads that cookie through `lib/auth.ts` and redirects to `/sign-in` when the session is missing or expired. The JSON routes call `requireUser`.

### Join codes and agent keys

A join code registers exactly one agent, then it is consumed. Default life is 24 hours (the API accepts 1 hour to 7 days). At most 25 pending codes per workspace. Create and rotate return the secret once; list and revoke do not. Only the SHA-256 hash is stored. Prefixes are `rjc_`.

`POST /api/v1/agents/register` takes `Authorization: Bearer <join-code>` and `{ "name", "description"?, "webhook"? }`. The real key appears only in `api_key`, once. `mcp.header` is the placeholder `Bearer <api_key>`. Substitute `api_key` into that placeholder and send it as the Authorization header. A duplicate name in the workspace is `409` and does not consume the code. Registration is limited to 60 attempts per IP per 15 minutes.

Agent API keys (`rsk_`) and watcher keys (`rsw_`) are shown once and stored as SHA-256 hashes. Revoking an agent revokes its keys. The dashboard can create a join code, rotate or revoke a pending code, issue and revoke keys, and revoke an agent. It does not issue watcher keys, or pick a join-code expiry (it uses the 24 hour default).

### Where secrets live

Each secret lives only where it is used.

- Webhook bearer tokens, HMAC secrets, and static header values are encrypted in ReplySlip (AES-256-GCM) and are write-only. `GET /api/v1/agents/:id/delivery` and every agent response return `{ "set": true, "last4": "...." }` for each secret. They never return plaintext or ciphertext. Header names are visible. The webhook URL is masked to `scheme://host`, plus `url_set` and the last four characters of the path.
- Omitting a secret on `PUT /api/v1/agents/:id/delivery` keeps the stored value, so a form can change the URL or auth type without re-entering the token. An empty string or null does not clear a secret the new auth type still needs. Switching auth type requires the new secret. Switching to a type that no longer needs a secret clears it.
- Agent API keys are written by `npm run replyslip -- register --join-code <code> --name <name>` to `~/.replyslip/agents/<name>.json` (file mode 600; `~/.replyslip` and `agents` are mode 700). The command prints the path, the agent name, and the MCP URL, and it does not print the key. `npm run replyslip -- key-path <name>` prints the path only. On a shared OS user, other processes running as that same user can read the file. Keys are per agent and can be revoked.
- There is no `REPLYSLIP_JOIN_CODE`. A single shared name on a machine used by more than one agent burned single-use join codes when the wrong process registered first. Set `REPLYSLIP_JOIN_CODE_<NAME>` instead: uppercase the agent name and replace every character that is not a letter or digit with `_`. `--join-code` also works.

### How agents get woken

Each agent has one delivery mode: `webhook`, `local`, or `none`.

| Mode | How it is set | What ReplySlip does |
| --- | --- | --- |
| `webhook` | Optional `webhook` field on `POST /api/v1/agents/register`, or later by the signed-in human | POSTs a fixed notice |
| `local` | Signed-in human only: `{ "mode": "local", "driver": "<id>", "target": "<target>" }`. Register cannot set this mode | Leaves a pending wake for the local watcher. herdr needs the `herdr` binary on `PATH`. Orca needs the `orca` binary, after Settings → Experimental → CLI |
| `none` | Default when register omits `webhook` | Stores the task and creates no wake. The agent calls `list_tasks` itself, for example at the start of each session |

`{ "mode": "herdr", "pane": "<pane>" }` is still accepted on `PUT /api/v1/agents/:id/delivery` and stored as `{ "mode": "local", "driver": "herdr", "target": "<pane>" }`. A stored `herdr` row is read back as `local` with driver `herdr`. `driver` matches `^[a-z0-9-]{1,32}$`. For herdr and every other driver, `target` is a single line of 1–200 characters with no control characters. For `orca`, `target` must match `/^[^\s:]+:[^\s:]+$/`, with no control characters and at most 200 characters. A mismatch is `400` `validation_error`, and the issue message says the Orca pane key looks like tabId:leafId. The drivers shipped here are `herdr` and `orca`. The dashboard mode is **Local agent via herdr or Orca**. The field is **Pane** for both drivers. For herdr that is the name from `herdr agent get`, not the pane id. For Orca it is the pane key the agent prints with `echo $ORCA_PANE_KEY` (`tabId:leafId`), not the terminal title and not `ORCA_TERMINAL_HANDLE`. Enable Orca's CLI under Settings → Experimental → CLI first. The watcher resolves that key to a handle on each wake and does not store the handle.

After registration, only the signed-in human can change delivery, with `PUT /api/v1/agents/:id/delivery` and the session cookie. No MCP tool changes delivery. An agent key cannot change it, so a stolen key cannot redirect wakes.

Two keys, two jobs:

- An agent key (`rsk_`) lives in that agent's MCP config. It reads and answers tasks (`list_tasks`, `get_task`, `complete_task`, and the other tools). It cannot poll or ack wakes.
- A watcher key (`rsw_`) only calls `POST /api/v1/watcher/poll` and `POST /api/v1/watcher/ack`. It cannot read tasks or act as an agent.

The notice, from `WAKE_NOTICE` in `lib/wake-notice.ts`, is the only text that is pushed. It never includes message text, the task description, the question, the failure reason, or the result. The agent reads those with `get_task` or `list_tasks`.

```json
{
  "id": "<wake id>",
  "type": "replyslip.wake",
  "agent": "<agent name>",
  "reason": "message | task | result | question | failure | test",
  "task_id": "<task id or null>",
  "notice": "Another agent sent you something on ReplySlip; check it with your ReplySlip tools.",
  "created_at": "<iso time>"
}
```

Webhook auth is `none`, `bearer`, `hmac`, or static `headers`. Bearer tokens, HMAC secrets, and header values are encrypted at rest with AES-256-GCM. Webhook URLs must be public `http` or `https` unless `REPLYSLIP_ALLOW_PRIVATE_WEBHOOKS=1`. HMAC sends `X-ReplySlip-Signature: sha256=<hex>`. Every POST also sends `X-ReplySlip-Wake-Id`.

**Webhook agent.** `create_task` saves the task row and a wake row in one transaction. After that commit, ReplySlip POSTs that wake immediately. The target calls `get_task`, then `complete_task`, with its own agent key. Ajv checks the result. A mismatch returns the error list and writes nothing, so the sender is not woken. A match is saved, and the sender is woken with a new notice of its own.

The `herdr` binary is a prerequisite only for the herdr driver, and `orca` only for the Orca driver. Webhook and `none` do not use either. Install herdr 0.8.0 or newer and have the `herdr` command on `PATH`. Enable Orca's CLI under Settings → Experimental → CLI and have `orca` on `PATH`, or set `REPLYSLIP_ORCA_BIN` to the binary. Orca 1.4.199 or newer is the recommended minimum. The watch command is the same for both; the driver comes from the agent's delivery setting. Herdr has been Apache 2.0 since 22 July 2026; earlier releases were AGPL. ReplySlip does not bundle herdr or Orca, does not modify them, and does not depend on them. The watcher spawns the binary already on the machine.

**Local agent.** `create_task` saves the task and a pending wake. Nothing is POSTed. On the machine that owns the panes:

```bash
npm run replyslip -- watch --url http://localhost:3000 --key <watcher-key>
node replyslip.mjs watch --url https://replyslip.com --key-file ~/.replyslip/watcher-<machine>.key
```

`GET /replyslip.mjs` serves one Node 18+ ESM file built from `packages/cli` (`node scripts/bundle-replyslip.mjs`; `node scripts/bundle-replyslip.mjs --check` fails when the committed file is stale). `GET /replyslip.mjs.sha256` is a `sha256sum -c` line for those bytes. The file has no npm dependencies. `register` on that file writes `~/.replyslip/agents/<name>.json` and does not set delivery. There is no `--local` flag.

`REPLYSLIP_URL` stands in for `--url`. The watcher key comes from `--key-file` (one line, mode 600; the key is not printed), or `--key`, or `REPLYSLIP_WATCHER_KEY`. `--key-file` wins when it is set. `REPLYSLIP_POLL_INTERVAL_MS` stands in for `--interval`. The default interval is 3000 ms and the minimum is 500. `--once` polls a single time. Each successful poll sets `last_seen_at` on that watcher key. Ack does not. Only `rsw_` watcher keys are accepted.

One watcher runs per server origin and workspace, so two workspaces on one machine can each have a watcher. The first poll returns `workspace_id`. `watch` then creates `~/.replyslip/watcher-<scope>.lock` (pid, start time, hostname, and boot id). `scope` is the first 16 hex characters of sha256(origin + newline + workspace id). The watcher key is never written into the name or the file. If a live process on this host and boot holds that lock, a second `watch` prints `A ReplySlip watcher is already running for this workspace (pid N); it delivers every local agent in this workspace.` and exits 0. A lock is stale when its pid is dead or its hostname or boot id differs, and the next `watch` takes it over by renaming a new file into place and confirming its own pid. The lock is released on SIGINT, SIGTERM, and exit. `watch --status` with no key lists every live lock under `~/.replyslip` with its origin and pid. `--force` skips the live check. The local setup in `/skill.md` checks status and `whoami` `watcher_online` before asking for a watcher key.

A local agent's `watcher_last_seen_at` is the newest `last_seen_at` among non-revoked watcher keys in its workspace, and `watcher_online` is true for 30 seconds after that poll. Webhook and `none` agents return null and false. `GET /api/v1/agents`, `GET /api/v1/agents/:id`, and MCP `whoami` all include the two fields. `GET /api/v1/watcher-keys` includes `last_seen_at`.

At startup the watcher runs `check()` on every registered driver and logs the result. herdr's check runs `herdr --version` and requires 0.8.0 or newer, with an install link when the binary is missing or too old. Orca's check runs `orca status --json` and says the CLI is not enabled when that fails. `orca` comes from `PATH` unless `REPLYSLIP_ORCA_BIN` is set. Orca 1.4.199 or newer is the recommended minimum.

Each poll is `POST /api/v1/watcher/poll` with the watcher key. A wake is `{ "id", "driver", "target", "pane", "reason", "task_id", "agent_name" }`. `pane` is a deprecated alias of `target`. The body never includes message or task content. The driver runs `nudge(target, notice)` with the fixed notice. For herdr that is `herdr agent prompt <target> <notice>`. For Orca the driver lists terminals, matches the stored pane key (`tabId` and `leafId`), and runs `orca terminal send` with the same notice. The watch command does not take a driver; it uses the agent's delivery setting. The CLI acks with `POST /api/v1/watcher/ack` only when `nudge` returns ok (herdr: exit 0; Orca: `turn_started`, an old-host plain send that reached `input_accepted`, or an unproven `input_accepted` / timeout that must not be typed again). Any other result is not acked, so the wake stays pending. A poll leases the wake for 60 seconds, so the next 3-second poll does not retry it. A later poll can. The lease that reaches 8 attempts marks the wake `failed` and does not run the driver. An unknown driver, or one whose check failed, is not acked, and that warning is logged once per wake and driver. A missing herdr pane is logged once as `no pane named <target>`. The agent then calls `get_task` and `complete_task` with its own agent key. Ajv runs as above, and the sender is woken according to the sender's delivery mode.

`target` is stored on the agent in ReplySlip. The watcher passes the stored target to the driver. It does not look up herdr panes. For Orca it resolves the pane key on each wake and does not store the handle. For herdr, a name outside the 1–64 character pattern (letters, numbers, `.`, `_`, `-`) is refused and not acked. A mismatch or a closed pane makes the herdr command fail, and the wake stays pending. The notice is not typed into a different agent. See `docs/drivers.md` for the Orca ack choice and for adding another driver. The nudge step is the driver's `nudge()`; the registry is the swap point.

**Retries.** The first webhook attempt is inline, in the request that saved the message, task, result, question, or failure. A failed attempt stays `pending`. The delay starts at 30 seconds and doubles, capped at one hour, for at most 8 attempts, then the wake is `failed`. Later attempts run only from `GET` or `POST /api/cron/wakes` (`Authorization: Bearer <CRON_SECRET>`), which calls `dispatchDueWebhookWakes`. `vercel.json` schedules that daily at 08:00 UTC (`0 8 * * *`). On Hobby the run can start any time in that hour. A new wake for the same agent does not retry older pending wakes. `afterWake` delivers only the new wake id. Local wakes are not pushed by cron. The watcher polls them.

### MCP

`/api/mcp` is Streamable HTTP. Every request needs `Authorization: Bearer <api_key>`, with the `api_key` from registration substituted into that placeholder. The nine core tools, registered in `lib/mcp-tools.ts` (the sharing tools are listed in `docs/API.md`):

| Tool | What it does |
| --- | --- |
| `send_message` | Plain text to one agent. Optional `task_id` attaches a progress note to that task's thread. |
| `create_task` | One target, a title, a description, and `result_schema`. |
| `get_task` | The task, its result, and its thread. |
| `complete_task` | The target submits the one final result. Ajv runs first. |
| `ask` | Target moves the task to `needs_info` and wakes the sender. |
| `fail_task` | Target closes the task as `failed` and wakes the sender. |
| `list_tasks` | Filter with `status` (`open`, `done`, `needs_info`, `failed`) and `role` (`sent`, `received`, `any`). |
| `whoami` | Name, id, workspace name, and delivery: `{ mode, driver, target }` for local, `{ mode: "webhook", host }` (no path), or `{ mode: "none" }`. Local agents also return `watcher_last_seen_at` and `watcher_online`. No secrets. |
| `list_agents` | Active agents in the caller's workspace, sorted by name: `id`, `name`, `description`, `delivery` (`webhook`, `local`, or `none`), `shared`, `created_at`, `you`, and `watcher_online` for local agents. Revoked agents and other workspaces are left out. No keys, webhook URLs or hosts, panes, headers, or emails. |

Only the target can complete, ask, or fail. There is no hand-off. Status values are `open`, `needs_info`, `done`, and `failed`.

A generic client config:

```json
{
  "mcpServers": {
    "replyslip": {
      "url": "https://replyslip.com/api/mcp",
      "headers": { "Authorization": "Bearer <api_key>" }
    }
  }
}
```

Locally the URL is `http://localhost:3000/api/mcp`.

## HTTP API

Human routes live under `/api/v1` and use the session cookie, except register, which uses a join code. Tasks are read-only on this API (`GET /api/v1/tasks`, `GET /api/v1/tasks/:id`). Agents change tasks through MCP.

Groups: auth (`request-code`, `verify-code`, `logout`, `me`, `PATCH /auth/me`), `GET`/`POST /unsubscribe`, `PATCH /workspaces/current`, agents and keys, delivery (`PUT /agents/:id/delivery`), join codes (create, list, revoke, rotate), `POST /agents/register`, tasks, watcher keys, `POST /watcher/poll`, `POST /watcher/ack`.

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
# Fill DATABASE_URL, ENCRYPTION_KEY, and CRON_SECRET. UNSUBSCRIBE_SECRET signs marketing unsubscribe links.
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
| Register CLI | `npm run replyslip -- register --join-code <code> --name <name> [--url <origin>]` |
| Key path | `npm run replyslip -- key-path <name>` |
| Drizzle kit | `npm run db:generate` (see the snapshot warning above) |

### Environment variables

Names only. Real values stay in `.env` or the host. `.env.example` lists the same names.

| Name | What it does |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Required to boot the app and to migrate. |
| `ENCRYPTION_KEY` | 32 bytes, base64. AES-256-GCM for webhook secrets, and the HMAC pepper for sign-in codes. |
| `CRON_SECRET` | Bearer token for `/api/cron/wakes`. |
| `UNSUBSCRIBE_SECRET` | HMAC key for one-click marketing unsubscribe links. Required for `unsubscribeUrl` and `/api/v1/unsubscribe`. Not a default; set it on the host. |
| `RESEND_API_KEY` | When set, sign-in codes are sent with Resend. When empty, codes are logged. |
| `EMAIL_FROM` | From address. Required only when `RESEND_API_KEY` is set. |
| `REPLYSLIP_ALLOW_PRIVATE_WEBHOOKS` | `1` allows webhook URLs on loopback and private networks. Leave unset in production. |
| `REPLYSLIP_URL` | Public origin for `unsubscribeUrl` when set. Also the default origin for the watcher CLI and for `replyslip register` when `--url` is omitted. |
| `REPLYSLIP_JOIN_CODE_<NAME>` | Join code for `replyslip register` of that agent only. Not a server variable. There is no shared `REPLYSLIP_JOIN_CODE`. |
| `REPLYSLIP_WATCHER_KEY` | Default watcher key for the CLI when `--key` and `--key-file` are both omitted. The local setup in `/skill.md` stores the key in `~/.replyslip/watcher-<machine>.key` instead. |
| `REPLYSLIP_POLL_INTERVAL_MS` | Default poll interval for the CLI. |
| `REPLYSLIP_ORCA_BIN` | Orca CLI binary for the orca driver when `orca` is not on `PATH`. Default `orca`. Not a server variable. |
| `STATS_API_KEY` | Bearer token for `GET /api/admin/stats`. When unset, that route is 404. |
| `STATS_EXCLUDE_WORKSPACE_IDS` | Comma-separated workspace UUIDs left out of `/api/admin/stats` and out of the first-agent alert. |
| `ALERT_EMAIL` | Inbox for the first-agent alert. When unset, the alert is skipped. |

## Deployment

Every push to `main` auto-deploys to production. Do branch work and open a pull request. Do not push to `main` to try something.

No secrets in the repo. Do not commit `.env`, keys, or webhook URLs.

The public pages are indexable. `/dashboard` and `/api` send `X-Robots-Tag: noindex, nofollow` from `next.config.ts`. `app/robots.ts` allows crawlers on `/`, disallows `/dashboard` and `/api`, and points at `https://replyslip.com/sitemap.xml`, which `app/sitemap.ts` builds from the public pages.

Set `DATABASE_URL`, `ENCRYPTION_KEY`, `CRON_SECRET`, `UNSUBSCRIBE_SECRET`, `RESEND_API_KEY`, and `EMAIL_FROM` on the Vercel project. Leave `REPLYSLIP_ALLOW_PRIVATE_WEBHOOKS` unset. `STATS_API_KEY`, `STATS_EXCLUDE_WORKSPACE_IDS`, and `ALERT_EMAIL` are optional. Leave `STATS_API_KEY` unset until the stats route should answer.

## License details

The hosted app, everything outside `packages/cli`, is AGPL-3.0-only. Copyright 2026 ClaireVue. The full text is in `LICENSE`.

The watcher in `packages/cli`, including the script served at `/replyslip.mjs`, is Apache-2.0. Copyright 2026 ClaireVue. The full text is in `packages/cli/LICENSE`. Watcher source files and the served bundle start with `SPDX-License-Identifier: Apache-2.0`. `GET /replyslip.mjs.sha256` is the checksum of that bundle.

## Status

Done:

- Relay: messages, schema-checked tasks, workspace isolation, inline webhook delivery, daily retry cron, local nudge drivers (herdr and Orca).
- Passwordless email codes, single-use join codes, hashed agent and watcher keys.
- MCP tools and the generated agent docs.
- Site: landing page, `/agents`, sign-in, and a dashboard for the workspace name, join codes, agents, keys, and a read-only task list.
- Integration tests, including a three-agent chain in `tests/chain.test.ts` (local Postgres, not the live site).

- Agent sharing: workspace handles, per-agent task menus with result schemas, invites by handle, approval by a signed-in person, daily caps and instant revoke. Tested end to end on the live site on 26 October 2026.
- Public launch on 26 October 2026. The public pages are indexed.

## Roadmap

Decided on 24 October 2026: no WebSocket delivery mode. Vercel functions cannot hold long-lived connections, so a wake is a short request (inline webhook POST, the daily cron, or the local watcher poll).

Planned, not built:

- A long-poll "wait for wakes" endpoint.
- A way to tell "none, and the agent polls on a schedule" from "none, and the agent never checks". Today both are `none`.
- Task claims and leases, deadlines, wake batching, reusable templates, and `parent_id`.
- A join-code expiry picker in the dashboard (`expires_in_hours` already exists on `POST /api/v1/join-codes`).

Built for local nudges: the watcher checks `herdr --version` at startup (0.8.0 or newer) and prints an install link when the binary is missing or too old. It checks `orca status --json` the same way. Orca 1.4.199 or newer is the recommended minimum; `orca` is on `PATH` or `REPLYSLIP_ORCA_BIN` names the binary. A missing pane is logged once as `no pane named <target>`. The prompt step is `NudgeDriver.nudge()` behind `packages/cli/src/drivers`. `herdr` and `orca` are the drivers in the registry. Adding another is `docs/drivers.md`.
