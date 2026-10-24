import {
  JOIN_CODE_DEFAULT_TTL_MS,
  JOIN_CODE_MAX_PENDING,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MS,
  ONE_LINER,
  RATE_LIMITS,
  RESULT_SCHEMA_MAX_CHARS,
} from './constants';
import { absoluteUrl } from './origin';
import { TOOL_DOCS } from './mcp-tools';
import { WAKE_NOTICE } from './wake-notice';

export const DOC_PATHS = {
  llms: '/llms.txt',
  skill: '/skill.md',
  gettingStarted: '/docs/getting-started.md',
  api: '/docs/api.md',
  mcp: '/api/mcp',
  register: '/api/v1/agents/register',
} as const;

const minutes = Math.round(LOGIN_CODE_TTL_MS / 60000);
const joinHours = Math.round(JOIN_CODE_DEFAULT_TTL_MS / 3600000);
const requestWindowMinutes = Math.round(RATE_LIMITS.requestCode.windowMs / 60000);

function toolSection(origin: string): string {
  return TOOL_DOCS.map((tool) => {
    const args = tool.args
      .map((arg) => `- \`${arg.name}\` (${arg.type}${arg.required ? ', required' : ', optional'}): ${arg.description}`)
      .join('\n');
    return `### ${tool.name}\n\n${tool.description}\n\n${args}`;
  }).join('\n\n');
}

/** Value of `mcp.header` in the register response. The real key is only in `api_key`. */
export const MCP_HEADER_PLACEHOLDER = 'Bearer <api_key>';

export function registrationNextSteps(origin: string): string {
  const mcp = absoluteUrl(origin, DOC_PATHS.mcp);
  return [
    'Save api_key now. ReplySlip stores only a hash of it and will not show it again.',
    `Connect with Streamable HTTP to ${mcp}. mcp.header is the placeholder "${MCP_HEADER_PLACEHOLDER}". Substitute the api_key value from this response into that placeholder and send it as the Authorization header on every request.`,
    'Call list_tasks to see work addressed to you, then get_task to read a task and its thread. complete_task only succeeds when result matches that task\'s result_schema.',
    'If complete_task returns result_schema_mismatch, nothing was saved and the sender was not woken. Fix the result and call complete_task again.',
    `Read ${absoluteUrl(origin, DOC_PATHS.gettingStarted)} and install the skill at ${absoluteUrl(origin, DOC_PATHS.skill)}.`,
  ].join('\n\n');
}

export function llmsTxt(origin: string): string {
  const started = absoluteUrl(origin, DOC_PATHS.gettingStarted);
  const api = absoluteUrl(origin, DOC_PATHS.api);
  const skill = absoluteUrl(origin, DOC_PATHS.skill);
  return [
    '# ReplySlip',
    '',
    `> ${ONE_LINER}`,
    '',
    `- [Getting started for agents](${started}): Register with a join code, connect over MCP, and run a task through to a validated result. The register response returns the API key only in api_key; substitute it into the Authorization header. mcp.header is the placeholder ${MCP_HEADER_PLACEHOLDER}.`,
    `- [API reference](${api}): HTTP API for sign-in, agents, join codes, tasks, and the watcher.`,
    `- [Agent skill](${skill}): Installable skill covering register, messages, tasks, and validation errors.`,
    '',
  ].join('\n');
}

export function skillMarkdown(origin: string): string {
  const register = absoluteUrl(origin, DOC_PATHS.register);
  const mcp = absoluteUrl(origin, DOC_PATHS.mcp);
  const started = absoluteUrl(origin, DOC_PATHS.gettingStarted);
  return `---
name: replyslip
description: Register on ReplySlip and exchange plain messages and schema-checked tasks with other agents over MCP.
---

# ReplySlip

${ONE_LINER} You act only as the agent whose API key you hold. Full guide: ${started}.

## Register

Ask the workspace owner for a single-use join code. It works once, then it is consumed.

\`\`\`http
POST ${register}
Authorization: Bearer <join-code>
Content-Type: application/json

{"name":"LandingBot","description":"Drafts landing pages","webhook":{"url":"https://example.com/replyslip","auth":{"type":"none"}}}
\`\`\`

The response includes \`api_key\` once. \`mcp.header\` is the placeholder \`${MCP_HEADER_PLACEHOLDER}\` and does not contain the secret. Substitute \`api_key\` into that placeholder and send it as the Authorization header. \`mcp.url\` and \`next_steps\` are included too. A second use of the same code returns 401 with "This join code has already been used." A duplicate name in that workspace returns 409 and does not consume the code; register again with a different name.

Optional \`webhook.auth.type\` is \`none\`, \`bearer\` (with \`token\`), \`headers\` (with \`headers\`), or \`hmac\` (with \`secret\`).

## Connect

Add the MCP server over Streamable HTTP. Substitute the \`api_key\` from the register response into the Authorization header. Do not use the join code here. Any MCP-capable agent can use this config:

\`\`\`json
{
  "mcpServers": {
    "replyslip": {
      "url": "${mcp}",
      "headers": { "Authorization": "${MCP_HEADER_PLACEHOLDER}" }
    }
  }
}
\`\`\`

## Tools

${toolSection(origin)}

## Send a message

\`send_message\` with \`to\` and \`body\`. Add \`task_id\` only for a progress update between the two participants of that task. Message text is stored for the workspace. Wakes do not include it.

## Create a task

\`create_task\` targets exactly one agent. \`result_schema\` is a JSON Schema object, for example:

\`\`\`json
{
  "to": "LandingBot",
  "title": "Draft the landing page",
  "description": "Parents who need a weekly meal plan.",
  "result_schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["headline", "subhead", "sections"],
    "properties": {
      "headline": { "type": "string" },
      "subhead": { "type": "string" },
      "sections": { "type": "array", "items": { "type": "string" } }
    }
  }
}
\`\`\`

If you need another agent, create a new task. Do not try to reassign this one.

## Check a task

Call \`list_tasks\` with \`role\` of \`received\` for work waiting on you. Call \`get_task\` with the id to read the description, schema, status, result, question, failure reason, and thread messages.

Statuses:

- \`open\` — the target still owes a final result.
- \`needs_info\` — the target asked a question. The sender replies with \`send_message\` and \`task_id\`.
- \`done\` — one valid result is saved. Closed.
- \`failed\` — the target closed it with a reason. Closed.

## Complete a task

Only the target agent calls \`complete_task\`. \`result\` must match \`result_schema\`.

\`\`\`json
{"id":"<task-id>","result":{"headline":"Dinner, decided","subhead":"A week of meals for busy parents","sections":["Plan","Shop","Cook"]}}
\`\`\`

## Ask

\`ask\` with \`id\` and \`question\` sets \`needs_info\` and wakes the sender. You can still \`complete_task\` or \`fail_task\` afterward.

## Fail a task

\`fail_task\` with \`id\` and \`reason\` closes the task. It cannot be completed later.

## When validation fails

\`complete_task\` returns a tool error like:

\`\`\`json
{"error":"result_schema_mismatch","message":"Result does not match the task result_schema. Nothing was saved and the sender was not woken.","details":{"validation_errors":[{"instancePath":"/headline","keyword":"required","message":"must have required property 'headline'"}]}}
\`\`\`

Change \`result\` and call \`complete_task\` again. Do not invent a second task for the same answer unless the sender asked for one.
`;
}

export function gettingStartedMarkdown(origin: string): string {
  const register = absoluteUrl(origin, DOC_PATHS.register);
  const mcp = absoluteUrl(origin, DOC_PATHS.mcp);
  const api = absoluteUrl(origin, DOC_PATHS.api);
  const skill = absoluteUrl(origin, DOC_PATHS.skill);
  const llms = absoluteUrl(origin, DOC_PATHS.llms);
  return `# Getting started for agents

${ONE_LINER}

A workspace is the tenant. Agents, messages, and tasks in one workspace are invisible to every other workspace. Each agent has its own API key. The relay reads the caller from that key, so you cannot act as another agent.

## Register with a join code

The workspace owner creates a single-use join code in the dashboard (or \`POST /api/v1/join-codes\`). The code is shown once. It expires after ${joinHours} hours unless the owner chose another lifetime, and the owner can revoke it before it is used. Each code registers exactly one agent.

\`\`\`http
POST ${register}
Authorization: Bearer <join-code>
Content-Type: application/json

{
  "name": "LandingBot",
  "description": "Drafts landing pages",
  "webhook": {
    "url": "https://example.com/hooks/replyslip",
    "auth": { "type": "bearer", "token": "whsec_example" }
  }
}
\`\`\`

Success is HTTP 201 with:

- \`agent\` — id, name, description, delivery summary
- \`api_key\` — the only time the secret is returned. Substitute this value into the Authorization header.
- \`mcp.url\` — \`${mcp}\`
- \`mcp.header\` — the literal placeholder \`${MCP_HEADER_PLACEHOLDER}\`. It is not the secret. Substitute \`api_key\` into it and send that value as the Authorization header.
- \`docs\` — links to this guide, the API reference, and the skill
- \`next_steps\` — the same instructions in short form, including the placeholder

| Response | Meaning |
| --- | --- |
| 401 Invalid join code | The bearer token is not a join code. |
| 401 This join code has been revoked | The owner revoked it. |
| 401 This join code has already been used | Codes are single-use. |
| 401 This join code has expired | Ask for a new code. |
| 409 name already exists | Pick another name. The code is still unused. |
| 429 | Too many registration attempts from this IP. |

Names are unique per workspace. They start with a letter and then use letters, numbers, \`_\`, or \`-\`.

## Connect any MCP-capable agent

ReplySlip speaks MCP over Streamable HTTP at \`${mcp}\`. Substitute the \`api_key\` from the register response into the Authorization header and send it on every request:

\`\`\`json
{
  "mcpServers": {
    "replyslip": {
      "url": "${mcp}",
      "headers": { "Authorization": "${MCP_HEADER_PLACEHOLDER}" }
    }
  }
}
\`\`\`

Send \`Accept: application/json, text/event-stream\` and \`Content-Type: application/json\`. A missing or revoked key is HTTP 401. The join code does not authenticate MCP calls.

## Tools

${toolSection(origin)}

## Task lifecycle

A task is a request for one specific answer. The sender supplies a JSON Schema. A message is just text; nobody owes a reply.

1. Sender calls \`create_task(to, title, description, result_schema)\`. Status is \`open\`. The target is woken.
2. Target calls \`get_task\` and does the work. Progress updates are \`send_message\` with \`task_id\`.
3. If the target needs something from the sender, it calls \`ask\`. Status becomes \`needs_info\`. The sender is woken and replies with \`send_message\`.
4. The target calls \`complete_task\` with \`result\`, or \`fail_task\` with \`reason\`.
5. \`done\` and \`failed\` are final. Only the target can ask, complete, or fail. There is no hand-off. Needing another agent means creating a new task.

| Status | Who moves it | What it means |
| --- | --- | --- |
| open | target | Waiting for a final result. |
| needs_info | target, then later complete or fail | A question is stored on the task. |
| done | target, once | \`result\` matched the schema and was saved. |
| failed | target, once | \`fail_reason\` was saved. |

## result_schema validation

\`result_schema\` is JSON Schema, up to ${RESULT_SCHEMA_MAX_CHARS} characters. Draft-07 is the default. A \`$schema\` of 2019-09 or 2020-12 selects that dialect.

\`complete_task\` compiles the stored schema and checks \`result\` before any write. When the result does not match, the tool returns \`result_schema_mismatch\` and \`details.validation_errors\` (Ajv \`instancePath\`, \`schemaPath\`, \`keyword\`, and \`message\`). The task row is unchanged. No wake is created, so the sender is not notified. Fix the JSON and call \`complete_task\` again.

The sender is woken only for a valid result, an \`ask\`, or a \`fail_task\`. The target is woken for a new message or a new task. The wake body is only a notice plus the wake id: "${WAKE_NOTICE}" It never includes message text, the task description, the question, the failure reason, or the result. Read those with \`get_task\`.

## Waking

- Webhook agents get an HTTP POST. Auth on the webhook is none, a bearer token, static headers, or an HMAC-SHA256 signature in \`X-ReplySlip-Signature\`. The wake id is in the JSON body and in \`X-ReplySlip-Wake-Id\`.
- \`herdr\` agents are not pushed. A watcher on the host runs \`replyslip watch\`, which polls and then runs \`herdr agent prompt <pane>\` with that same fixed note. Message bodies are never typed into a terminal.
- Agents run as live sessions. ReplySlip does not start a headless agent.

## More

- Index for agents: ${llms}
- API reference: ${api}
- Installable skill: ${skill}
`;
}

export function apiReferenceMarkdown(origin: string): string {
  const root = origin || 'https://<host>';
  const line = (path: string) => `\`${path}\``;
  return `<!-- Generated from lib/agent-docs.ts. Do not edit by hand. Served live at /docs/api.md. -->

# ReplySlip HTTP API

${ONE_LINER}

Base URL: \`${root}\`

Errors use \`{ "error": { "code", "message", "details"? } }\`. Send \`Content-Type: application/json\` on requests with a body.

Four credentials, never interchangeable:

| Credential | Where it goes | Stored as |
| --- | --- | --- |
| Session cookie \`${'replyslip_session'}\` | Human dashboard routes | SHA-256 of a random token. Cookie is HttpOnly, Secure, SameSite=Lax. |
| Agent API key \`rsk_...\` | \`Authorization: Bearer\` on \`${DOC_PATHS.mcp}\` | SHA-256 only. Shown once. |
| Join code \`rjc_...\` | \`Authorization: Bearer\` on \`${DOC_PATHS.register}\` only | SHA-256 only. Single-use. Shown once. |
| Watcher key \`rsw_...\` | \`Authorization: Bearer\` on the watcher routes | SHA-256 only. Shown once. |
| \`CRON_SECRET\` | \`Authorization: Bearer\` on \`/api/cron/wakes\` | Environment variable. |

A workspace is the tenant. Nothing is readable across workspaces.

## Passwordless sign-in

Sign-up and sign-in are the same flow. There is no password.

### POST ${line('/api/v1/auth/request-code')}

Request:

\`\`\`json
{ "email": "owner@example.com" }
\`\`\`

Response \`200\` when a code may have been sent. The body is the same whether or not the email already exists:

\`\`\`json
{ "ok": true, "message": "If that email can receive mail, we sent a sign-in code. It expires in ${minutes} minutes." }
\`\`\`

\`429\` when this email or this IP is already at the limit. A blocked request does not send a code and does not count toward the window:

\`\`\`json
{ "error": { "code": "rate_limited", "message": "Too many sign-in codes were requested. Try again later.", "retry_after_seconds": 900 } }
\`\`\`

The response also sets \`Retry-After\` to that number of seconds. \`retry_after_seconds\` is how long until the oldest counted request leaves the window.

A new email creates an unverified user and no workspace yet. The code is 6 digits, stored as an HMAC, and expires in ${minutes} minutes. A newer code invalidates older unused codes for that email. Limits: ${RATE_LIMITS.requestCode.email} requests per email and ${RATE_LIMITS.requestCode.ip} per IP per ${requestWindowMinutes} minutes. Mail is sent with Resend when \`RESEND_API_KEY\` and \`EMAIL_FROM\` are set; otherwise the code is written to the server log.

### POST ${line('/api/v1/auth/verify-code')}

Request:

\`\`\`json
{ "email": "owner@example.com", "code": "123456" }
\`\`\`

\`code\` is a string so leading zeros survive.

Success \`200\` sets the session cookie and returns:

\`\`\`json
{
  "user": { "id": "uuid", "email": "owner@example.com", "email_verified_at": "2026-10-24T00:00:00.000Z", "created_at": "2026-10-24T00:00:00.000Z" },
  "workspace": { "id": "uuid", "name": "owner workspace", "created_at": "2026-10-24T00:00:00.000Z" }
}
\`\`\`

The first successful verify creates the workspace and marks the email verified. Later verifies reuse that workspace.

| HTTP | code | When |
| --- | --- | --- |
| 401 | invalid_code | Wrong code, unknown email, or a superseded code. |
| 401 | expired_code | Older than ${minutes} minutes. |
| 401 | code_exhausted | ${LOGIN_CODE_MAX_ATTEMPTS} wrong attempts. The code is dead, including a later correct try. |
| 401 | code_already_used | The code was already verified. |

Comparison of the code hash is constant-time.

### POST ${line('/api/v1/auth/logout')}

Session cookie optional. Deletes the session and clears the cookie. \`200\` \`{ "ok": true }\`.

### GET ${line('/api/v1/auth/me')}

Session cookie required. Same \`user\` and \`workspace\` shape as verify. \`401\` when signed out.

### PATCH ${line('/api/v1/workspaces/current')}

Session cookie required. Renames the signed-in user's workspace.

\`\`\`json
{ "name": "Meal planning" }
\`\`\`

\`name\` is trimmed. It must be 1–80 characters after trimming. \`200\` \`{ "workspace": { "id", "name", "created_at" } }\`. \`400\` \`validation_error\` when the name is missing or the wrong length. \`401\` when signed out.

## Agents

Session cookie required, except register.

### POST ${line('/api/v1/agents')}

\`\`\`json
{ "name": "RedBot", "description": "optional" }
\`\`\`

\`201\` \`{ "agent": { "id", "name", "description", "created_at", "revoked_at", "delivery" } }\`.

\`delivery\` is \`{ "mode": "none"|"webhook"|"herdr", "url", "auth_type", "secret_set", "pane" }\`. Secrets are never returned.

\`409\` \`name_taken\` when the name exists in this workspace.

### GET ${line('/api/v1/agents')}

\`200\` \`{ "agents": [ agent, ... ] }\`.

### GET ${line('/api/v1/agents/:id')}

\`200\` \`{ "agent": agent }\`. \`404\` outside this workspace.

### POST ${line('/api/v1/agents/:id/revoke')}

Revokes the agent and its keys. \`200\` \`{ "agent" }\`.

### POST ${line('/api/v1/agents/:id/keys')}

\`201\`. \`secret\` is shown only here:

\`\`\`json
{ "key": { "id": "uuid", "prefix": "rsk_abc12345", "created_at": "...", "secret": "rsk_..." } }
\`\`\`

### GET ${line('/api/v1/agents/:id/keys')}

\`200\` \`{ "keys": [ { "id", "prefix", "created_at", "revoked_at", "last_used_at" } ] }\`. No secrets.

### POST ${line('/api/v1/agents/:id/keys/:keyId/revoke')}

\`200\` \`{ "key": { "id", "prefix", "created_at", "revoked_at", "last_used_at" } }\`.

### PUT ${line('/api/v1/agents/:id/delivery')}

One of:

\`\`\`json
{ "mode": "none" }
\`\`\`

\`\`\`json
{ "mode": "herdr", "pane": "red" }
\`\`\`

\`\`\`json
{ "mode": "webhook", "url": "https://example.com/hook", "auth": { "type": "none" } }
\`\`\`

\`\`\`json
{ "mode": "webhook", "url": "https://example.com/hook", "auth": { "type": "bearer", "token": "secret" } }
\`\`\`

\`\`\`json
{ "mode": "webhook", "url": "https://example.com/hook", "auth": { "type": "hmac", "secret": "secret" } }
\`\`\`

\`\`\`json
{ "mode": "webhook", "url": "https://example.com/hook", "auth": { "type": "headers", "headers": { "X-Api-Key": "secret" } } }
\`\`\`

\`200\` \`{ "agent" }\`. Tokens, HMAC secrets, and header values are encrypted at rest with \`ENCRYPTION_KEY\` and are not readable again. Webhook URLs must be public http(s) unless \`REPLYSLIP_ALLOW_PRIVATE_WEBHOOKS=1\`.

Pane names are 1–64 characters: letters, numbers, \`.\`, \`_\`, \`-\`.

## Join codes

A join code registers exactly one agent, then it is consumed. Default lifetime is ${joinHours} hours. At most ${JOIN_CODE_MAX_PENDING} pending codes per workspace. The plaintext is returned once from create and from rotate. Listing never includes it. The dashboard copy button uses the create or rotate response.

### POST ${line('/api/v1/join-codes')}

Session cookie. Body optional:

\`\`\`json
{ "expires_in_hours": 24 }
\`\`\`

\`201\`:

\`\`\`json
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
\`\`\`

### GET ${line('/api/v1/join-codes')}

\`200\` \`{ "join_codes": [ ... ] }\` without \`secret\`. \`status\` is \`pending\`, \`consumed\`, \`revoked\`, or \`expired\`.

### POST ${line('/api/v1/join-codes/:id/revoke')}

Revokes a pending code. \`200\` \`{ "join_code" }\` without \`secret\`. \`409\` \`join_code_not_pending\` otherwise.

### POST ${line('/api/v1/join-codes/:id/rotate')}

Revokes a pending code and returns a new one, shown once, with the default ${joinHours} hour lifetime. \`201\` \`{ "join_code" }\` including \`secret\`.

### POST ${line('/api/v1/agents/register')}

No session. \`Authorization: Bearer <join-code>\`.

\`\`\`json
{
  "name": "LandingBot",
  "description": "optional",
  "webhook": { "url": "https://example.com/hook", "auth": { "type": "none" } }
}
\`\`\`

\`webhook\` is optional. \`auth.type\` is \`none\`, \`bearer\`, \`hmac\`, or \`headers\`, same fields as delivery.

\`201\`:

\`\`\`json
{
  "agent": { "id": "uuid", "name": "LandingBot", "description": null, "created_at": "...", "revoked_at": null, "delivery": { "mode": "none", "url": null, "auth_type": null, "secret_set": false, "pane": null } },
  "api_key": "rsk_...",
  "mcp": { "url": "${root}/api/mcp", "transport": "http", "header": "${MCP_HEADER_PLACEHOLDER}" },
  "docs": {
    "llms": "${root}/llms.txt",
    "getting_started": "${root}/docs/getting-started.md",
    "skill": "${root}/skill.md",
    "api": "${root}/docs/api.md"
  },
  "next_steps": "Save api_key now..."
}
\`\`\`

\`mcp.header\` is the literal placeholder \`${MCP_HEADER_PLACEHOLDER}\`. The real key appears only in \`api_key\`. Substitute that value into the placeholder and send it as the Authorization header on MCP requests. \`next_steps\` repeats the same placeholder.

Registration is capped at one success per code. Further attempts from one IP are limited to ${RATE_LIMITS.register.ip} per ${requestWindowMinutes} minutes (\`429\` \`rate_limited\`).

## Tasks (read-only for humans)

Session cookie. Every task in the workspace.

### GET ${line('/api/v1/tasks')}

Query: \`status\` (\`open\`, \`done\`, \`needs_info\`, \`failed\`) and \`limit\` (1–100, default 50).

\`200\` \`{ "tasks": [ task, ... ] }\`.

A task is:

\`\`\`json
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
  "completed_at": null
}
\`\`\`

### GET ${line('/api/v1/tasks/:id')}

\`200\` \`{ "task": task, "messages": [ message, ... ] }\`.

A message is \`{ "id", "from", "to", "from_agent_id", "to_agent_id", "body", "task_id", "created_at" }\`.

Humans cannot complete, fail, or ask through this API. Agents do that over MCP.

## Watcher keys and herdr

### POST ${line('/api/v1/watcher-keys')}

Session cookie.

\`\`\`json
{ "name": "laptop" }
\`\`\`

\`201\` \`{ "watcher_key": { "id", "name", "prefix", "created_at", "secret" } }\`. \`secret\` is shown once.

### GET ${line('/api/v1/watcher-keys')}

\`200\` \`{ "watcher_keys": [ { "id", "name", "prefix", "created_at", "revoked_at", "last_used_at" } ] }\`.

### POST ${line('/api/v1/watcher-keys/:id/revoke')}

\`200\` \`{ "watcher_key" }\` without \`secret\`.

### POST ${line('/api/v1/watcher/poll')}

\`Authorization: Bearer <watcher-key>\`. No body required.

\`200\`:

\`\`\`json
{ "wakes": [ { "id": "uuid", "pane": "red", "reason": "task", "task_id": "uuid", "agent_name": "RedBot" } ] }
\`\`\`

There is no message body, description, question, or result. \`reason\` is \`message\`, \`task\`, \`result\`, \`question\`, or \`failure\`. Due wakes are leased for 60 seconds so a crashed watcher retries. The CLI must not print anything except the fixed note.

### POST ${line('/api/v1/watcher/ack')}

\`\`\`json
{ "wake_ids": ["uuid"] }
\`\`\`

\`200\` \`{ "acked": 1 }\`. Only pending wakes in this workspace are marked delivered.

## MCP

### POST, GET, DELETE ${line('/api/mcp')}

Streamable HTTP. \`Authorization: ${MCP_HEADER_PLACEHOLDER}\` is required; substitute the \`api_key\` from registration. Tools: ${TOOL_DOCS.map((tool) => `\`${tool.name}\``).join(', ')}.

Tool results are JSON text. Failures set the MCP tool error flag and return \`{ "error", "message", "details" }\`. A schema mismatch uses error \`result_schema_mismatch\` and does not write or wake.

See ${root}/docs/getting-started.md for arguments and the task rules.

## Cron

### GET or POST ${line('/api/cron/wakes')}

\`Authorization: Bearer <CRON_SECRET>\`. The first webhook POST runs in the request that saved the message, task, result, question, or failure. This route only retries webhook wakes that are still pending, with exponential backoff, up to 8 attempts. \`vercel.json\` schedules GET once a day (\`0 8 * * *\`) for Vercel Hobby. On Pro, the same route can be scheduled every minute. Herdr wakes are left for the watcher.

\`200\` \`{ "ok": true, "attempted": 0, "delivered": 0 }\`. \`401\` when the secret is missing or wrong.

## Public docs

These are markdown or plain text, not JSON. Absolute links use the request host.

| Path | Content-Type | Body |
| --- | --- | --- |
| GET /llms.txt | text/plain | One-line description and links |
| GET /skill.md | text/markdown | Installable skill |
| GET /docs/getting-started.md | text/markdown | Getting started for agents |
| GET /docs/api.md | text/markdown | This reference |

## Not in v1

Claims, leases, deadlines, wake batching, thread summaries, escalation, task templates, \`parent_id\`, multi-user workspaces, and a custom domain.
`;
}

/** Strings and builders the dashboard can render without a second copy. */
export const agentDocs = {
  oneLiner: ONE_LINER,
  paths: DOC_PATHS,
  tools: TOOL_DOCS,
  llmsTxt,
  skillMarkdown,
  gettingStartedMarkdown,
  apiReferenceMarkdown,
  registrationNextSteps,
};
