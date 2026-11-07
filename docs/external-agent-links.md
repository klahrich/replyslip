# External agent links

An owner shares specific offers with an agent that runs somewhere else. The recipient does not sign up, pick a handle, or join the owner's workspace.

## Why this shape

Valetto already turns an invite into a private guest workspace, a share, and offer grants (`agent_invites`, `agent_shares`). That guest is not a member of the owner's workspace. This change uses that lifecycle instead of a second login system.

A single-use link (`max_uses` 1, the dashboard default) is the credential. The first call binds one invisible guest named `guest`. A later call with the same token is that same guest, including two calls that race. There is no second key to copy, and the token is not the owner's key.

A multi-use link is not a shared bearer. Each redeem creates its own guest and returns a guest key once. If the token itself were the bearer, every recipient would be the same guest and would see each other's tasks.

The guest credential can call `whoami`, `get_agent_card`, `create_task`, `get_task`, `list_tasks`, and `answer_task`. It cannot list the owner's agents, read tasks it did not send, message inside a workspace, finish the owner's work, or call sharing and admin tools. OAuth owner scope is unchanged. `redeem_invite` stays an owner tool for an agent that already has its own Valetto key.

Creating the link in the dashboard is the owner's approval when "They can use these tasks as soon as they connect" is on (the default). Unchecking it leaves the guest `pending` until a signed-in human approves, which an agent key still cannot do.

The guest is not a virtual agent inside the owner's workspace. Putting it there would mix an untrusted caller with the owner's own agents. The separate workspace is what keeps `list_agents`, task visibility, and plan accounting apart.

## What the recipient does

Give them the link (`/i#rsi_…`). The token is in the fragment, so it is not sent to the server, a query string, or a referrer. The page tells their agent how to connect and, for a single-use link, shows an MCP config.

Valetto cannot install that config. A host that only connects through OAuth sign-in cannot use the link. Do not send the recipient through Valetto signup to get around that. Hosts that accept a remote MCP URL plus a static `Authorization` header can use the config. Everyone else uses the HTTP routes under `/api/v1/external` with the same bearer.

Valetto does not run the external agent and does not push to a host it cannot wake. The caller polls `list_tasks` or `GET /api/v1/external/tasks`. A webhook is used only when a redeem call sets one.

## Limits, revocation, expiry

- Offers not on the link look the same as unknown offers (`offer_not_found`).
- `daily_cap` is a rolling 24 hours on that share. A rejected input does not spend it.
- Connecting spends one of the owner's guest slots (`guest_workspaces` on the free plan).
- Tasks the guest sends count on the guest workspace's monthly allowance (1,000 on the free plan), not on the owner's monthly cap.
- Revoking the link makes the `rsi_` bearer fail on the next call. It does not by itself fail open tasks or kill a guest key that a multi-use redeem already returned. The dashboard says so: a one-guest link stops the person already using it; a multi-guest link does not.
- Revoking the guest fails open tasks. The next `create_task` or `get_agent_card` returns `share_revoked`. `get_task` on a task they already sent still returns it, with `fail_reason` `access revoked`, so they can see why it stopped.
- After `expires_at`, that grant is dead. `get_agent_card`, `create_task`, `get_task`, and `answer_task` return `401` `invite_expired`. `list_tasks` leaves those tasks out. Claiming the workspace does not bring the grant back. Redeeming a second, live invite with the same key does not bring it back either. The new invite works. The old one does not.
- A retried `create_task` is not idempotent. It opens another task and spends the daily cap again. This path does not take a `client_request_id` yet.
- A revoked guest cannot redeem that invite again from the same client address, and an invite never undoes a revoke.

## Rollout

No migration. The tables are the ones already used for agent invites.

Set `VALETTO_AGENT_GUESTS=1` on the deployment that should offer new links. Leave it unset and create, preview, redeem, and the `rsi_` bearer are `404`. That is the current production default. Do not flip it as part of a code deploy until you mean to.

The flag is not a kill switch. Turning it off does not revoke guest keys (`rsk_`) already issued, and it does not expire grants. Those keys keep working until you revoke that guest or the invite's `expires_at` passes. Revoke the guest to stop a key that is already out. Expiry stops that grant even if the guest workspace has been claimed.

Claiming the guest workspace (`claim_url`) stays optional. It attaches an email to that private workspace. It does not add the person to the owner's workspace. After a claim, that key can manage its own workspace (a handle, sharing its own agent). That is ordinary post-claim access. It does not revive an invite that has expired, and the invite token itself stays limited to the grant.
