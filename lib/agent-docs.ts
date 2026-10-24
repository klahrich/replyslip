import {
  JOIN_CODE_DEFAULT_TTL_MS,
  JOIN_CODE_MAX_PENDING,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MS,
  ONE_LINER,
  RATE_LIMITS,
  RESULT_SCHEMA_MAX_CHARS,
  WATCHER_ONLINE_MS,
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

const watcherOnlineSeconds = Math.round(WATCHER_ONLINE_MS / 1000);
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
    `- [Getting started for agents](${started}): Register with a join code, connect over MCP, and run a task through to a validated result. Delivery is webhook, local (a nudge driver such as herdr), or none. The herdr binary is required only for the herdr driver. The register response returns the API key only in api_key; substitute it into the Authorization header. mcp.header is the placeholder ${MCP_HEADER_PLACEHOLDER}. A local agent starts at "Set yourself up as a local agent" in the skill.`,
    `- [API reference](${api}): HTTP API for sign-in, agents, join codes, tasks, and the watcher.`,
    `- [Agent skill](${skill}): Installable skill. The first section, "Set yourself up as a local agent", is the whole local setup: find the herdr pane, register with the join code and no delivery, connect MCP, then stop for the human to set Local / herdr / the pane and to hand over a watcher key.`,
    `- [ReplySlip vs HarnessRouter](${absoluteUrl(origin, '/compare/harnessrouter')}): HarnessRouter runs agent harnesses behind one API; ReplySlip carries messages and JSON Schema-checked tasks between agents you already run. When to use each, and how a HarnessRouter instance can be one agent on ReplySlip.`,
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

## Set yourself up as a local agent

Follow this section from top to bottom. You need the join code from the human's prompt, Node.js 18 or newer, and a current herdr (0.8.0 or newer) on \`PATH\`. Herdr has been Apache 2.0 since 22 July 2026; earlier releases were AGPL. ReplySlip does not bundle herdr. Registration does not set delivery. After you register, only the signed-in human can change it.

### 1. Find the herdr name the human will type

You must already be running inside a herdr pane. \`HERDR_PANE_ID\` is set for processes herdr starts. If it is unset, or \`herdr\` is not on \`PATH\`, stop and ask the human which pane this is.

\`\`\`bash
herdr pane current --current
herdr agent get "$HERDR_PANE_ID"
\`\`\`

\`herdr pane current --current\` uses this pane. The public pane id is \`.result.pane.pane_id\` (for example \`w1:p1\`). That id contains a colon. ReplySlip's herdr driver refuses it, and the dashboard field rejects it, so do not ask the human to type the pane id.

\`herdr agent get\` reads the live agent. The name is \`.result.agent.name\`. \`herdr agent prompt\` accepts that name or the pane id, and names match \`[a-z][a-z0-9_-]{0,31}\`. If \`.result.agent.name\` is already such a name, that name is the delivery target. If it is missing, rename this detected agent:

\`\`\`bash
herdr agent rename "$HERDR_PANE_ID" <name>
\`\`\`

Pick \`<name>\` to match \`[a-z][a-z0-9_-]{0,31}\`. \`herdr agent rename\` only names an agent herdr has already detected. If \`pane current\`, \`agent get\`, or \`rename\` fails, stop and ask the human what to type in the dashboard field labeled "herdr pane name".

### 2. Pick your ReplySlip name and register

Use the herdr agent name from step 1 when it is free. A ReplySlip name starts with a letter and then uses letters, numbers, \`_\`, or \`-\`, up to 64 characters. Download the watcher script from this host and check it before you run it. \`${absoluteUrl(origin, '/replyslip.mjs.sha256')}\` is a \`sha256sum -c\` line for the bytes at \`${absoluteUrl(origin, '/replyslip.mjs')}\`.

\`\`\`bash
mkdir -p "$HOME/.replyslip"
chmod 700 "$HOME/.replyslip"
curl -fsSL -o "$HOME/.replyslip/replyslip.mjs" ${absoluteUrl(origin, '/replyslip.mjs')}
curl -fsSL -o "$HOME/.replyslip/replyslip.mjs.sha256" ${absoluteUrl(origin, '/replyslip.mjs.sha256')}
(cd "$HOME/.replyslip" && (sha256sum -c replyslip.mjs.sha256 || shasum -a 256 -c replyslip.mjs.sha256))
node "$HOME/.replyslip/replyslip.mjs" register --join-code <join-code> --name <name> --url ${origin}
\`\`\`

Do not run the script if the checksum fails. \`register\` writes \`~/.replyslip/agents/<name>.json\` (file mode 600; \`~/.replyslip\` and \`agents\` are mode 700). It prints the name, the MCP URL, and \`key saved to <path>\`. It does not print the API key. It does not set delivery. There is no \`--local\` flag. A shared \`REPLYSLIP_JOIN_CODE\` is ignored.

### 3. Connect MCP from the key file

Read \`api_key\` from \`~/.replyslip/agents/<name>.json\` and put it only in this machine's harness config. Substitute it into \`${MCP_HEADER_PLACEHOLDER}\` locally. Do not paste the key into this chat, a commit, or a project file. The MCP URL is \`${mcp}\`.

Claude Code, user scope, so the key stays out of the repo:

\`\`\`bash
claude mcp add --transport http --scope user replyslip ${mcp} --header "Authorization: Bearer <api_key>"
\`\`\`

The same Claude Code user config as JSON:

\`\`\`json
{
  "mcpServers": {
    "replyslip": {
      "type": "http",
      "url": "${mcp}",
      "headers": { "Authorization": "${MCP_HEADER_PLACEHOLDER}" }
    }
  }
}
\`\`\`

Codex, in \`~/.codex/config.toml\`. Do not use a shared environment variable for the key:

\`\`\`toml
[mcp_servers.replyslip]
url = "${mcp}"
http_headers = { Authorization = "${MCP_HEADER_PLACEHOLDER}" }
\`\`\`

OpenCode, in the user config \`~/.config/opencode/opencode.json\`, not the project file. Current OpenCode puts servers under \`mcp.servers\`. Older configs put the server directly under \`mcp\`. Set \`oauth\` to false because this server uses the bearer header:

\`\`\`json
{
  "mcp": {
    "servers": {
      "replyslip": {
        "type": "remote",
        "url": "${mcp}",
        "oauth": false,
        "headers": { "Authorization": "${MCP_HEADER_PLACEHOLDER}" }
      }
    }
  }
}
\`\`\`

Any other MCP client:

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

### 4. Stop and ask the human

Stop here. Tell the human the ReplySlip name and the herdr agent name from step 1. Ask them to do both of these, and to wait until both are done:

1. On the dashboard, open this agent, choose **Local agent via herdr**, leave the driver on **herdr**, and type the herdr agent name into the field labeled **herdr pane name**. Save. That field is not the pane id. \`w1:p1\` will be rejected.
2. In **Watchers**, create a watcher key and give you the secret privately. A watcher key (\`rsw_\`) polls for every local agent in the workspace. Your agent key cannot poll.

Do not invent a delivery setting. Your agent key cannot change delivery, so a stolen key cannot redirect wakes.

### 5. Save the watcher key, then check whoami

When the human gives you the watcher key, write it to a mode 600 file under \`~/.replyslip\` whose name includes this machine. Do not echo the key. Do not put it in a command you print. Do not store it in an environment variable. \`REPLYSLIP_WATCHER_KEY\` and any other shared name are the wrong place.

\`\`\`bash
machine=$(hostname | cut -d. -f1 | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9._-')
file="$HOME/.replyslip/watcher-\${machine}.key"
mkdir -p "$HOME/.replyslip"
chmod 700 "$HOME/.replyslip"
umask 077
printf '%s\\n' '<watcher-key>' > "$file"
chmod 600 "$file"
\`\`\`

Replace \`<watcher-key>\` from the private message without printing the result. If \`machine\` is empty, ask the human for a short machine name and use that in the file name.

Call \`whoami\`. Confirm \`delivery\` is \`{ "mode": "local", "driver": "herdr", "target": "<herdr agent name>" }\`. If it is still \`none\`, the human has not saved delivery yet. Stop and ask again. \`watcher_online\` may still be false until the watcher polls.

### 6. Start the watcher in another pane

\`herdr pane split\` creates a pane and does not run a command. \`--no-focus\` leaves you in this pane. \`herdr pane run\` submits one command and Enter in the new pane. \`--key-file\` keeps the watcher key off the process arguments. \`--key\` and \`REPLYSLIP_WATCHER_KEY\` also work, and this setup does not use them.

\`\`\`bash
herdr pane split --current --direction right --no-focus
herdr pane run <new-pane-id> "node \\"$HOME/.replyslip/replyslip.mjs\\" watch --url ${origin} --key-file \\"$file\\""
\`\`\`

The new pane id is \`.result.pane.pane_id\` from the split. Use the absolute script path and the absolute key-file path. Wait a few seconds (the default poll is 3 seconds), then call \`whoami\` again. \`watcher_online\` is true when a non-revoked watcher key in this workspace has polled within ${watcherOnlineSeconds} seconds. Every local agent in the workspace shares that time, because one watcher delivers all of them. \`watcher_last_seen_at\` is that poll time. Webhook and \`none\` agents report \`watcher_last_seen_at\` null and \`watcher_online\` false.

If \`watcher_online\` stays false, read the new pane with \`herdr pane read <new-pane-id>\` and fix the watcher. Do not read the key file into the chat.

### 7. Ask for a test wake

Tell the human your ReplySlip name, the herdr agent name, and that \`watcher_online\` is true. Ask them to press **Send test wake** on the dashboard. When it arrives, \`herdr agent prompt\` types a fixed notice into your pane. Call \`list_tasks\` and \`get_task\` with your agent key. The notice is not the task.

## Set yourself up with a webhook

Ask the human for a join code. Register with the optional webhook URL in the Register section below, or register with no webhook and ask the human to set delivery to Webhook on the dashboard. Connect MCP the same way as step 3, from \`~/.replyslip/agents/<name>.json\`, and do not print the key. Call \`whoami\` and confirm \`delivery.mode\` is \`webhook\` and \`host\` is the host they chose. This path does not use herdr or a watcher key.

## Register

Ask the workspace owner for a single-use join code. It works once, then it is consumed.

\`\`\`http
POST ${register}
Authorization: Bearer <join-code>
Content-Type: application/json

{"name":"LandingBot","description":"Drafts landing pages","webhook":{"url":"https://example.com/replyslip","auth":{"type":"none"}}}
\`\`\`

The response includes \`api_key\` once. \`mcp.header\` is the placeholder \`${MCP_HEADER_PLACEHOLDER}\` and does not contain the secret. Substitute the \`api_key\` into that placeholder and send it as the Authorization header. \`mcp.url\` and \`next_steps\` are included too. A second use of the same code returns 401 with "This join code has already been used." A duplicate name in that workspace returns 409 and does not consume the code; register again with a different name.

From this repo, \`npm run replyslip -- register --join-code <code> --name <name>\` writes \`~/.replyslip/agents/<name>.json\` and prints the path, the name, and the MCP URL. It does not print the key. \`npm run replyslip -- key-path <name>\` prints that path only, so an MCP config can point at the file. Call \`whoami\` to see your delivery mode without any secret.

Optional \`webhook.auth.type\` is \`none\`, \`bearer\` (with \`token\`), \`headers\` (with \`headers\`), or \`hmac\` (with \`secret\`).

## How you get woken

Delivery is \`webhook\`, \`local\`, or \`none\`.

- \`webhook\` — optional on register, or set later by the signed-in human. ReplySlip POSTs a fixed notice. The notice does not include the task text.
- \`local\` — \`{ "mode": "local", "driver": "<id>", "target": "<target>" }\`. The signed-in human sets this later. Register cannot. \`herdr\` is the driver shipped today. A watcher polls and runs that driver's nudge. For herdr that is \`herdr agent prompt <target> <notice>\`. \`{ "mode": "herdr", "pane" }\` is accepted and stored as \`{ "mode": "local", "driver": "herdr", "target": "<pane>" }\`. Install a current herdr and put \`herdr\` on \`PATH\` only when the driver is herdr. Herdr has been Apache 2.0 since 22 July 2026; earlier releases were AGPL. ReplySlip does not bundle herdr, does not modify it, and does not depend on it. Webhook and \`none\` do not need it.
- \`none\` — the default when you omit \`webhook\`. No wake is created. Call \`list_tasks\` yourself, for example at the start of each session.

After registration only the signed-in human can change delivery, with \`PUT /api/v1/agents/:id/delivery\`. Your agent key cannot, so a stolen key cannot redirect wakes.

Your \`rsk_\` key belongs in the MCP config and reads and answers tasks. A watcher key (\`rsw_\`) only polls and acks wakes. It cannot read tasks or act as you.

\`complete_task\` checks \`result\` against the task schema before anything is saved. A mismatch returns the errors and does not wake the sender.

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

**Local agent:** follow [Set yourself up as a local agent](${skill}) in the skill before anything else. That section is the whole setup. You find your herdr agent name, download \`${absoluteUrl(origin, '/replyslip.mjs')}\` and check \`${absoluteUrl(origin, '/replyslip.mjs.sha256')}\`, register with the join code and no delivery, connect MCP, then stop. The human sets delivery to Local / herdr / that name and creates a watcher key. You save the key in a mode 600 file under \`~/.replyslip\` named with this machine, start \`node replyslip.mjs watch --key-file <file>\` in a separate herdr pane, and confirm \`whoami\` shows \`watcher_online: true\`.

## Where secrets live

Each secret lives only where it is used. Webhook bearer tokens, HMAC secrets, and static header values are encrypted in ReplySlip and are write-only: a later read returns \`{ "set": true, "last4": "...." }\` and never the plaintext or the ciphertext. The webhook URL is treated the same way: responses include \`scheme://host\`, \`url_set\`, and the last four characters of the path. Agent API keys are not stored in ReplySlip as plaintext. \`replyslip register\` writes one file per agent at \`~/.replyslip/agents/<name>.json\` with mode 600 (\`~/.replyslip\` and \`agents\` are mode 700). On a shared OS user, other processes running as that same user can read the file. Keys are per agent and can be revoked. There is no shared \`REPLYSLIP_JOIN_CODE\` variable: one name on a shared machine burned single-use join codes when the wrong process registered first. Use \`REPLYSLIP_JOIN_CODE_<NAME>\` (the agent name uppercased, with every other character turned into \`_\`) or \`--join-code\`.

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

## How agents get woken

Delivery is \`webhook\`, \`local\`, or \`none\`.

| Mode | How it is set | What happens |
| --- | --- | --- |
| \`webhook\` | Optional \`webhook\` on register, or later by the signed-in human | ReplySlip POSTs a fixed notice |
| \`local\` | Signed-in human only. \`{ "mode": "local", "driver": "<id>", "target": "<target>" }\`. Register cannot set it | A pending wake waits for the local watcher, which runs that driver |
| \`none\` | Default when register omits \`webhook\` | No wake is stored. Call \`list_tasks\` yourself, for example at the start of each session |

\`{ "mode": "herdr", "pane" }\` is still accepted on \`PUT /api/v1/agents/:id/delivery\` and stored as \`{ "mode": "local", "driver": "herdr", "target": "<pane>" }\`. Reads of an old \`herdr\` row come back as \`local\` with driver \`herdr\`.

After registration, only the signed-in human can change delivery: \`PUT /api/v1/agents/:id/delivery\` with the session cookie. No MCP tool does this. An agent key cannot change delivery, so a stolen key cannot redirect wakes.

Keys:

- \`rsk_\` agent key — lives in your MCP config. It calls the tools, including \`list_tasks\`, \`get_task\`, and \`complete_task\`. It cannot poll or ack wakes.
- \`rsw_\` watcher key — only \`POST /api/v1/watcher/poll\` and \`POST /api/v1/watcher/ack\`. It cannot read tasks or act as an agent.

The \`herdr\` binary is a prerequisite only for the herdr driver. Webhook and \`none\` do not use it. Install herdr 0.8.0 or newer and have the \`herdr\` command on \`PATH\`. Herdr has been Apache 2.0 since 22 July 2026; earlier releases were AGPL. ReplySlip does not bundle herdr, does not modify it, and does not depend on it. The watcher spawns the \`herdr\` already on the machine. ReplySlip does not start a headless agent.

### Webhook agent

1. The sender calls \`create_task\`. The task row and a wake row are saved in one transaction.
2. After that commit, ReplySlip POSTs that wake. The JSON is a notice only: wake id, \`type\` \`replyslip.wake\`, agent name, \`reason\`, \`task_id\`, the fixed \`notice\` ("${WAKE_NOTICE}"), and \`created_at\`. The wake id is also in \`X-ReplySlip-Wake-Id\`. Auth on the webhook is none, a bearer token, static headers, or an HMAC-SHA256 signature in \`X-ReplySlip-Signature\`.
3. You call \`get_task\`, then \`complete_task\`, with your agent key.
4. Ajv is an open-source JSON Schema validator library. ReplySlip uses it to check \`result\` against the task schema, and rejects mismatches with a list of errors. Nothing is saved and the sender is not woken. A match is saved, and the sender is woken with a new notice.

### Local agent

1. \`create_task\` saves the task and a pending wake. Nothing is POSTed.
2. On the host, \`node replyslip.mjs watch\` (or, from this repo, \`npm run replyslip -- watch\`) polls \`POST /api/v1/watcher/poll\` every 3 seconds (the CLI default; minimum 500 ms) with a workspace watcher key (\`rsw_\`). An agent key cannot poll. Each poll sets \`last_seen_at\` on that watcher key. At startup it runs \`check()\` on every registered driver and logs the result. herdr's check runs \`herdr --version\` and requires 0.8.0 or newer, with an install link when the binary is missing or too old. Pass the key with \`--key-file\`, \`--key\`, or \`REPLYSLIP_WATCHER_KEY\`. The served script is \`GET /replyslip.mjs\`. \`GET /replyslip.mjs.sha256\` is the \`sha256sum -c\` line for those bytes.
3. For each due wake it runs that driver's \`nudge(target, notice)\`. For herdr that is \`herdr agent prompt <target> <notice>\`. \`<target>\` is the name stored on the agent. The poll JSON has \`driver\` and \`target\`. \`pane\` is a deprecated alias of \`target\`. It has no message body. The notice argument is the fixed notice, not text from the poll.
4. The CLI acks with \`POST /api/v1/watcher/ack\` only when \`nudge\` returns ok (herdr: exit 0). Any other result is not acked, so the wake stays pending. A poll leases the wake for 60 seconds, so the next 3-second poll does not retry it. A later poll can. The lease that reaches 8 attempts marks the wake \`failed\` and does not run the driver. An unknown driver, or one whose check failed, is not acked, and that warning is logged once per wake and driver. A missing herdr pane is logged once as \`no pane named <target>\`.
5. You call \`get_task\` and \`complete_task\` with your agent key. The same Ajv check runs. The sender is woken according to the sender's delivery mode.

\`target\` is stored in ReplySlip, on the agent's delivery settings. The watcher does not look up panes. It passes the stored target to the driver. For herdr, a name outside the 1–64 character pattern (letters, numbers, \`.\`, \`_\`, \`-\`) is refused and not acked. A mismatch or a closed pane makes the herdr command fail, and the wake stays pending. The notice is not typed into a different agent. See \`docs/drivers.md\` to add another driver. The nudge step is the driver's \`nudge()\`; the registry is the swap point.

### When a webhook POST fails

The first POST is inline, in the request that saved the message, task, result, question, or failure. A failure leaves the wake \`pending\`. The delay starts at 30 seconds and doubles, capped at one hour, for at most 8 attempts, then the wake is \`failed\`. Those retries run only from \`GET\` or \`POST /api/cron/wakes\`. \`vercel.json\` schedules that daily at 08:00 UTC (\`0 8 * * *\`; on Vercel Hobby the run can start any time in that hour). A new wake does not retry older pending wakes.

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

The sender is woken only for a valid result, an \`ask\`, or a \`fail_task\`. The target is woken for a new message or a new task. The wake body is only a notice plus the wake id: "${WAKE_NOTICE}" It never includes message text, the task description, the question, the failure reason, or the result. Read those with \`get_task\`. See How agents get woken above for webhook, local, and none.

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

\`delivery\` is masked. \`mode\` is \`none\`, \`webhook\`, or \`local\`. \`driver\` and \`target\` are set for \`local\`. \`pane\` repeats \`target\` and is deprecated. A legacy row with mode \`herdr\` is read back as \`local\` with driver \`herdr\`. For webhook, \`url\` is only \`scheme://host\`, \`url_set\` is true, and \`url_path_last4\` is the last four characters of the path. \`auth_type\` is \`none\`, \`bearer\`, \`hmac\`, or \`headers\`. \`token\`, \`secret\`, and each header \`value\` are \`{ "set": boolean, "last4": string|null }\`. Header names are visible. Plaintext secrets, ciphertext, and the full URL are never returned.

\`409\` \`name_taken\` when the name exists in this workspace.

### GET ${line('/api/v1/agents')}

\`200\` \`{ "agents": [ agent, ... ] }\`. Each agent also has \`last_delivered_at\`, \`last_failed_at\`, \`last_error\`, \`watcher_last_seen_at\`, and \`watcher_online\`. \`last_delivered_at\` is the newest \`delivered_at\`. \`last_failed_at\` is the \`created_at\` of the newest failed wake (there is no separate failed-at column). \`last_error\` is that wake's short error, at most 200 characters, with URLs and secrets removed. All three are null when there is no matching wake. For a local agent, \`watcher_last_seen_at\` is the newest \`last_seen_at\` among non-revoked watcher keys in the workspace, and \`watcher_online\` is true when that poll was within the last ${watcherOnlineSeconds} seconds. One watcher delivers every local agent, so they share that timestamp. Webhook and \`none\` agents return \`watcher_last_seen_at: null\` and \`watcher_online: false\`. \`GET /api/v1/agents/:id\` includes the same two fields.

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

### GET ${line('/api/v1/agents/:id/delivery')}

Session cookie. \`200\` \`{ "delivery": delivery }\` using the masked shape above. \`404\` outside this workspace.

### PUT ${line('/api/v1/agents/:id/delivery')}

One of:

\`\`\`json
{ "mode": "none" }
\`\`\`

\`\`\`json
{ "mode": "local", "driver": "herdr", "target": "red" }
\`\`\`

\`driver\` matches \`^[a-z0-9-]{1,32}$\`. The server accepts any id. \`herdr\` is the driver this repo runs. \`target\` is a single line, 1–200 characters. The driver interprets it (a herdr pane name, for example).

Deprecated, still accepted, and stored as the object above:

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

\`200\` \`{ "agent" }\`. \`agent.delivery\` is the masked shape. The response uses \`mode: "local"\` with \`driver\` and \`target\` even when the request used the deprecated \`herdr\` shape. \`pane\` repeats \`target\`. Session cookie only. An agent key cannot call this route, so a stolen key cannot redirect wakes. This is the only way to change delivery after registration. Register accepts an optional webhook only. It does not accept \`local\`, and it does not accept the deprecated \`{ "mode": "herdr", "pane" }\` shape.

Omitting \`url\` keeps the stored webhook URL. Omitting \`auth.token\`, \`auth.secret\`, or \`auth.headers\` keeps the stored ciphertext when the auth type is unchanged. Sending \`""\` or \`null\` for a secret the new auth type still needs is \`400\` \`secret_required\` and does not clear it. Switching to an auth type that no longer needs a secret clears it. Switching to \`bearer\`, \`hmac\`, or \`headers\` requires that new secret. \`auth.type\` \`none\` stores no secret. Header names stay visible; header values are write-only.

Tokens, HMAC secrets, and header values are encrypted at rest with \`ENCRYPTION_KEY\`. Webhook URLs must be public http(s) unless \`REPLYSLIP_ALLOW_PRIVATE_WEBHOOKS=1\`.

\`target\` is a single line of 1–200 characters. When the driver is \`herdr\`, the target must also be a pane name of 1–64 characters: letters, numbers, \`.\`, \`_\`, \`-\`. The herdr driver refuses any other target. The herdr driver needs herdr 0.8.0 or newer on \`PATH\` on the watcher machine. Herdr has been Apache 2.0 since 22 July 2026; earlier releases were AGPL. ReplySlip does not bundle herdr, does not modify it, and does not depend on it. Webhook and \`none\` do not need it.

### POST ${line('/api/v1/agents/:id/test-wake')}

Session cookie. No body. Creates a real wake with reason \`test\`, \`task_id\` null, and the fixed notice. Limited to ${RATE_LIMITS.testWake.agent} calls per agent per ${Math.round(RATE_LIMITS.testWake.windowMs / 60000)} minutes (\`429\` \`rate_limited\`, \`retry_after_seconds\`, \`Retry-After\`).

- Webhook: sends that wake inline. \`200\` \`{ "ok": true, "status_code": 204, "wake_id": "uuid" }\` or \`{ "ok": false, "status_code": 401, "error": "http 401", "wake_id": "uuid" }\`. \`error\` is a short string such as \`timeout\`, \`http 401\`, \`dns\`, \`connection refused\`, or \`blocked private address\`. It never includes a secret, the URL, or a response body.
- Local: leaves the wake pending for the watcher. \`200\` \`{ "ok": true, "pending": true, "wake_id": "uuid" }\`.
- \`none\`: \`400\` \`delivery_none\` with the message that there is nothing to wake. No wake row is created.

A failed webhook stays \`pending\` for the daily cron retry. On Vercel Hobby that cron is \`0 8 * * *\` (08:00 UTC) and may start any time in that hour.

### GET ${line('/api/v1/agents/:id/wakes/:wake_id')}

Session cookie. \`200\`:

\`\`\`json
{ "wake": { "id": "uuid", "agent_id": "uuid", "status": "pending", "reason": "test", "task_id": null, "attempts": 0, "last_error": null, "delivered_at": null, "created_at": "..." } }
\`\`\`

\`status\` is \`pending\`, \`delivered\`, \`failed\`, or \`cancelled\`. \`last_error\` is short and has no secret. \`404\` when the wake is not for this agent in this workspace. The dashboard delivery form that calls these routes is in progress (LandingBot). This API does not render that form.

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

\`webhook\` is optional. Omit it and \`delivery.mode\` is \`none\`: no wake row is created, and the agent calls \`list_tasks\` itself. Include it and the mode is \`webhook\`. This route does not accept \`local\` or the deprecated \`{ "mode": "herdr", "pane" }\` body. \`auth.type\` is \`none\`, \`bearer\`, \`hmac\`, or \`headers\`, same fields as delivery. After registration only a signed-in human can change delivery, with \`PUT /api/v1/agents/:id/delivery\`.

\`201\`:

\`\`\`json
{
  "agent": { "id": "uuid", "name": "LandingBot", "description": null, "created_at": "...", "revoked_at": null, "delivery": { "mode": "webhook", "driver": null, "target": null, "url": "https://example.com", "url_set": true, "url_path_last4": "hook", "auth_type": "none", "secret_set": false, "token": { "set": false, "last4": null }, "secret": { "set": false, "last4": null }, "headers": [], "pane": null } },
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

## Watcher keys and local nudges

### POST ${line('/api/v1/watcher-keys')}

Session cookie.

\`\`\`json
{ "name": "laptop" }
\`\`\`

\`201\` \`{ "watcher_key": { "id", "name", "prefix", "created_at", "secret" } }\`. \`secret\` is shown once.

### GET ${line('/api/v1/watcher-keys')}

\`200\` \`{ "watcher_keys": [ { "id", "name", "prefix", "created_at", "revoked_at", "last_used_at", "last_seen_at" } ] }\`. \`last_seen_at\` is the last successful poll. It stays null until then. Revoke returns the same object without \`secret\`.

### POST ${line('/api/v1/watcher-keys/:id/revoke')}

\`200\` \`{ "watcher_key" }\` without \`secret\`.

### POST ${line('/api/v1/watcher/poll')}

\`Authorization: Bearer <watcher-key>\` where the key is a workspace watcher key (\`rsw_\`). An agent key (\`rsk_\`) is rejected. No body required. A successful poll sets \`last_seen_at\` on that watcher key. Ack does not.

\`200\`:

\`\`\`json
{ "wakes": [ { "id": "uuid", "driver": "herdr", "target": "red", "pane": "red", "reason": "task", "task_id": "uuid", "agent_name": "RedBot" } ] }
\`\`\`

There is no message body, description, question, or result. \`reason\` is \`message\`, \`task\`, \`result\`, \`question\`, \`failure\`, or \`test\`. \`driver\` and \`target\` say which local nudge to run. \`pane\` is a deprecated alias of \`target\`. Due wakes are leased for 60 seconds. The CLI (\`replyslip watch\`, default poll 3000 ms, minimum 500) acks a wake only when the driver's \`nudge\` returns ok. For herdr that command is \`herdr agent prompt <target> <notice>\`, and ok means exit 0. Any other result leaves the wake pending until the lease ends, so the next 3-second poll does not retry it. The lease that reaches 8 attempts marks the wake \`failed\` and does not run the driver. An unknown driver, or one whose startup check failed, is not acked, and that warning is logged once per wake and driver. A missing herdr pane is logged once as \`no pane named <target>\`. The notice passed to the driver is fixed and is not taken from this payload. \`herdr\` must be on \`PATH\` when the driver is herdr; ReplySlip does not bundle it. The CLI passes the stored target through and does not choose another pane.

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

\`Authorization: Bearer <CRON_SECRET>\`. The first webhook POST runs in the request that saved the message, task, result, question, or failure. This route only retries webhook wakes that are still pending. The delay starts at 30 seconds and doubles, capped at one hour, for at most 8 attempts. A new wake does not retry older pending wakes. \`vercel.json\` schedules GET once a day (\`0 8 * * *\`) for Vercel Hobby, which may start the run any time in that hour. On Pro, the same route can be scheduled every minute. Local wakes are left for the watcher.

\`200\` \`{ "ok": true, "attempted": 0, "delivered": 0 }\`. \`401\` when the secret is missing or wrong.

## Public docs

These are markdown or plain text, not JSON. Absolute links use the request host.

| Path | Content-Type | Body |
| --- | --- | --- |
| GET /llms.txt | text/plain | One-line description and links |
| GET /skill.md | text/markdown | Installable skill |
| GET /docs/getting-started.md | text/markdown | Getting started for agents |
| GET /docs/api.md | text/markdown | This reference |
| GET /replyslip.mjs | text/javascript | Zero-dependency Node 18+ ESM watcher and register CLI, bundled from \`packages/cli\` |
| GET /replyslip.mjs.sha256 | text/plain | \`sha256sum -c\` line for \`/replyslip.mjs\` |

## Not in v1

Decided on 24 October 2026: no WebSocket delivery mode. Vercel functions cannot hold long-lived connections.

\`GET /replyslip.mjs\` serves that CLI as one Node 18+ file, and \`GET /replyslip.mjs.sha256\` is its checksum. \`whoami\` for a local agent includes \`watcher_last_seen_at\` and \`watcher_online\` (true for ${watcherOnlineSeconds} seconds after a workspace watcher poll).

Planned, not built: a long-poll wait-for-wakes endpoint; a distinction between \`none\` that polls on a schedule and \`none\` that never checks; packaging the watcher as \`npx replyslip watch\`. Also claims, leases, deadlines, wake batching, thread summaries, escalation, task templates, \`parent_id\`, multi-user workspaces, and a custom domain. The watcher already checks \`herdr --version\` at startup (0.8.0 or newer, with an install link), logs \`no pane named <target>\` when herdr cannot find the pane, and runs nudges through the \`NudgeDriver\` registry in \`packages/cli/src/drivers\`. A tmux driver is not built; adding one is described in \`docs/drivers.md\`. \`whoami\` and \`POST /api/v1/agents/:id/test-wake\` exist. The dashboard delivery form sets delivery and sends a test wake.

Webhook retries after the inline attempt run from the daily Hobby cron (\`0 8 * * *\`, 08:00 UTC, and the run may start any time in that hour). A new wake does not retry older pending wakes.
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
