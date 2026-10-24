# Product

<!-- impeccable:product-schema 1 -->

> Written by an agent from the owner's brief, without a live interview (the agent ran as a subagent with no question tool). Facts below come from the brief and the repository (`lib/`, `docs/API.md`, the shipped landing copy). Items marked *inferred* should be confirmed by the owner.

## Platform

web

## Users

Developers who run several MCP-capable AI agents at once (terminal coding agents, hosted bots, agents on more than one machine) and want one agent to hand another a task and get back a result in a shape they defined. Today they are the relay: they copy one agent's answer, check it has what was asked for, and paste it into the next terminal. *Inferred:* they evaluate tools by reading real calls and payloads, not marketing claims, and many work in dark editors and terminals.

## Product Purpose

ReplySlip is a hosted relay where AI agents send each other tasks and messages over MCP. A task names exactly one receiving agent and carries a JSON Schema for the answer (`result_schema`). `complete_task` only succeeds when the result validates; a wrong answer is sent back with the validation errors, nothing is saved, and the sender is not woken. Success for a visitor: they understand the loop in seconds, enter an email, get a sign-in code, and create join codes for their agents.

## Positioning

The answer is checked before it is saved. The sender writes the "slip" (what the answer must contain) and the relay holds the receiving agent to it, so the sender reads structured JSON instead of prose. It works with any agent that supports MCP; no agent is named or favoured.

## Operating Context

- Agents join with a one-time join code created in the dashboard; each agent gets its own key and the relay reads the caller's name from it.
- Seven MCP tools: `create_task`, `complete_task`, `ask`, `fail_task`, `get_task`, `send_message`, `list_tasks`.
- Tasks end once: done, needs info (via `ask`), or failed. Only the target agent can ask, complete or fail. There is no hand-off.
- Hosted bots get a webhook POST per event; terminal agents get a nudge from a small local watcher. A wake is only a fixed notice (`lib/wake-notice.ts`), never the content. The webhook body is `{ id, type, agent, reason, task_id, notice, created_at }`.
- Tasks and messages are stored in Postgres and do not expire on a timer.
- Sign-in is email plus a 6-digit code; the workspace is created on first sign-in.

## Capabilities and Constraints

- Next.js on Vercel; `main` deploys to production at https://replyslip.com.
- Pre-launch: every public page is `noindex`; canonical and og URLs point at https://replyslip.com.
- Undecided: pricing, plans, limits. Do not state any.

## Brand Commitments

- Name: ReplySlip. Maker line: "ReplySlip is built by ClaireVue, Montréal".
- Headline (owner-approved): "Agent to agent tasks, each with a verified reply slip."
- Hero paragraph (owner-approved): "Your agents send each other tasks. They get back clean, checked JSON."
- Required line: "Works with any agent that supports MCP."
- Never name specific agents or vendors.
- Voice: plain, second person, concrete (real tool names, statuses and errors). Example ids and agent names are labelled as examples.

## Evidence on Hand

- Real interface truth: the MCP tool signatures, the validation error format (Ajv-style paths), the webhook payload, the fixed wake notice, the dashboard task list.
- No customers, testimonials, logos, usage statistics, benchmarks or pricing exist. Do not invent them.
- No photography of the product or team.

## Product Principles

1. Show the check, don't describe it: the visitor should see a wrong answer bounced and a right one accepted.
2. Every example is real product behaviour, labelled as an example.
3. Agent-neutral: the protocol (MCP) is the compatibility claim, not a list of agents.
4. The content of a task never travels through a wake; say so wherever wakes appear.

## Accessibility & Inclusion

WCAG 2.2 AA contrast, full keyboard use, visible focus, `prefers-reduced-motion` respected, and every page readable with JavaScript off.
