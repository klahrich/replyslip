import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { agents, oauthAuthorizationRequests, oauthClients, type OAuthClientRow } from '@/db/schema';
import type { SessionUser } from '../auth';
import { AGENT_NAME_PATTERN } from '../constants';
import { keyedHash, safeEqualHex, sha256 } from '../crypto';
import { HttpError } from '../errors';
import { planLimitMessage, workspacePlanUsage } from '../plans';
import { bindingMatches } from './authorize';
import { clientDisplay, type ClientDisplay } from './clients';
import {
  ELEVATED_SCOPES,
  OAUTH_SCOPE,
  SCOPE_OWNER,
  SCOPE_RESPOND,
  dcrEnabled,
  effectiveScopes,
  oauthIssuer,
  ownerGrantMaxDays,
  ownerScopeEnabled,
  type ElevatedScope,
} from './config';
import { agentNameBase, createAuthorizationCode, firstFreeAgentName, isReconnectTarget, reconnectOptions } from './grants';
import { isLoopbackHost, redirectHost, redirectKind, withQuery, type RedirectKind } from './redirect';
import { REQUEST_TOKEN_PATTERN, oauthNow } from './tokens';

/**
 * The consent page's data and its Allow / Deny POST (docs/design/mcp-oauth.md §5.3, §5.4, §6.1, §6.2). LandingBot's
 * page at app/(site)/oauth/consent/page.tsx calls loadConsentRequest; the POST lives in app/api/oauth/consent.
 */

export type ConsentView = {
  request_id: string;
  csrf_token: string;
  expires_at: string;
  client: ClientDisplay;
  /**
   * Where the code goes. `host` and `loopback` are the original §6.1 fields. `kind` and `scheme` were added with DCR
   * (PR 3) and are always set by the server; they are optional in the type so older fixtures still compile.
   * kind: 'https' (a web callback), 'loopback' (http://localhost, 127.0.0.1 or [::1]: same as loopback: true), or
   * 'custom_scheme' (an app on this computer, e.g. cursor://; `scheme` is "cursor", without "://").
   */
  redirect: { host: string; loopback: boolean; kind?: RedirectKind; scheme?: string | null };
  user: { email: string };
  workspaces: Array<{ id: string; name: string; handle: string | null }>;
  agent: {
    suggested_name: string;
    name_pattern: string;
    reconnect_options: Array<{ id: string; name: string; last_connected_at: string | null }>;
  };
  scope: { name: 'agent'; allows: string[]; denies: string[] };
  /**
   * §5.10: higher scopes offered on top of `agent`. While MCP_OAUTH_OWNER_SCOPE is on, `offered` always lists both
   * (agent:respond, agent:owner), whether or not the app asked for them: the user's opt-in is the authority. While
   * the flag is off it is empty; then show nothing extra. Show each one with its `allows` list behind its own
   * unchecked checkbox. The POST's `grant_scopes` lists the ticked ones; each is added to `agent`. None ticked (or the
   * field absent): `agent` only.
   */
  extra_scopes: {
    /** `requested_by_client`: the app asked for this scope itself (most apps ask only for `agent` or nothing). */
    offered: Array<{ name: ElevatedScope; title: string; allows: string[]; requested_by_client: boolean }>;
    /** The consent POST field: an array of the ticked `offered[].name` values. */
    opt_in_field: 'grant_scopes';
    /** True when `offered` is non-empty and the app is not verified (client.verified false). Show `warning`. */
    unverified_client: boolean;
    /** Plain-language warning for an unverified app; null otherwise. */
    warning: string | null;
    /** Show when both are ticked; null when fewer than two are offered. */
    combined_warning: string | null;
    /** With either one ticked, the connection ends after this many days and must be approved again; null if nothing offered. */
    connection_days: number | null;
  };
  plan: { at_agent_limit: boolean; agent_limit: number | null };
};

/** Plain-language copy for the one v1 scope (§5.7, decided narrow; 2b = no replies on received tasks). */
export const AGENT_SCOPE_COPY = {
  allows: [
    'Send tasks to your agents, as its own agent, and follow up or answer questions on those tasks',
    'Read the tasks it sent or received, and their answers',
    'See your agents and the shared agents you can reach',
  ],
  denies: [
    'Reply to, finish or message on tasks sent to it',
    'Send messages outside a task it created',
    'Change your workspace handle or agent sharing',
    'Add, change or remove offers',
    'Invite, approve or remove guests',
    'Review or release customer requests, or see customer emails',
    'Change dashboard settings',
  ],
};

/** Plain-language copy for each higher scope (§5.10). Offered on every consent page while the flag is on. */
export const ELEVATED_SCOPE_COPY: Record<ElevatedScope, { title: string; allows: string[] }> = {
  [SCOPE_RESPOND]: {
    title: 'Work on tasks sent to it',
    allows: [
      'Finish tasks other agents send to it, with an answer',
      'Turn down tasks sent to it, with a reason',
      'Ask the sender a question about a task sent to it',
      'Send messages on any task it is part of, not only tasks it created',
    ],
  },
  [SCOPE_OWNER]: {
    title: 'Manage your workspace settings and guests',
    allows: [
      'Change your workspace handle',
      'Share or stop sharing your agents',
      'Add, change or remove offers',
      'Invite guests, remove them, and see who has access',
      'Accept invites from other workspaces',
    ],
  },
};

export const COMBINED_ELEVATED_WARNING =
  'With both, anyone who sends this app a task could try to get it to change your sharing or guests.';

export const UNVERIFIED_ELEVATED_WARNING =
  "Valetto can't confirm who made this app. Only give it these extra permissions if you trust it.";

const NOT_FOUND = () => new HttpError(404, 'request_not_found', 'This connection request was not found.');
const EXPIRED = () => new HttpError(410, 'request_expired', 'This connection request has expired. Start again from the app.');
const COMPLETED = () => new HttpError(409, 'request_completed', 'This connection request was already used.');

/** HMAC(ENCRYPTION_KEY, 'oauth-consent' ‖ request_id ‖ user_id). SessionUser carries no session id, so the user id binds it. */
export function consentCsrfToken(requestId: string, userId: string): string {
  return keyedHash('oauth-consent', `${requestId}\u0000${userId}`);
}

type WorkspaceUser = SessionUser & { workspace: NonNullable<SessionUser['workspace']> };

function requireWorkspace(user: SessionUser): WorkspaceUser {
  if (!user.workspace) throw new HttpError(409, 'workspace_required', 'This account has no workspace yet.');
  return user as WorkspaceUser;
}

async function clientRow(id: string): Promise<OAuthClientRow> {
  const [client] = await getDb().select().from(oauthClients).where(eq(oauthClients.id, id)).limit(1);
  if (!client || client.disabledAt) throw NOT_FOUND();
  // A request a DCR client started before MCP_OAUTH_DCR was turned off can't be approved afterwards.
  if (client.kind === 'dcr' && !dcrEnabled()) throw NOT_FOUND();
  return client;
}

async function agentLimitState(workspaceId: string): Promise<{ at_agent_limit: boolean; agent_limit: number | null }> {
  const usage = await workspacePlanUsage(workspaceId);
  const limit = usage.limits.agents;
  return { at_agent_limit: limit !== null && usage.usage.agents >= limit, agent_limit: limit };
}

/**
 * The consent view for `req`. Binds the request to this user on the first signed-in view; another user gets 404.
 * Throws HttpError 404 request_not_found, 410 request_expired, 409 request_completed or 409 workspace_required.
 */
export async function loadConsentRequest(req: string, user: SessionUser): Promise<ConsentView> {
  if (typeof req !== 'string' || !REQUEST_TOKEN_PATTERN.test(req)) throw NOT_FOUND();
  const db = getDb();
  const [request] = await db
    .select()
    .from(oauthAuthorizationRequests)
    .where(eq(oauthAuthorizationRequests.requestHash, sha256(req)))
    .limit(1);
  if (!request || (request.userId !== null && request.userId !== user.id)) throw NOT_FOUND();
  if (request.completedAt) throw COMPLETED();
  if (request.expiresAt.getTime() <= oauthNow().getTime()) throw EXPIRED();
  const member = requireWorkspace(user);
  if (request.userId === null) {
    const bound = await db
      .update(oauthAuthorizationRequests)
      .set({ userId: user.id })
      .where(and(eq(oauthAuthorizationRequests.id, request.id), isNull(oauthAuthorizationRequests.userId)))
      .returning({ id: oauthAuthorizationRequests.id });
    if (bound.length === 0) {
      const [again] = await db
        .select({ userId: oauthAuthorizationRequests.userId })
        .from(oauthAuthorizationRequests)
        .where(eq(oauthAuthorizationRequests.id, request.id))
        .limit(1);
      if (again?.userId !== user.id) throw NOT_FOUND();
    }
  }
  const client = await clientRow(request.clientId);
  const host = redirectHost(request.redirectUri);
  const workspace = member.workspace;
  return {
    request_id: request.id,
    csrf_token: consentCsrfToken(request.id, user.id),
    expires_at: request.expiresAt.toISOString(),
    client: clientDisplay(client),
    redirect: { host, loopback: isLoopbackHost(host), ...redirectKind(request.redirectUri) },
    user: { email: user.email },
    workspaces: [{ id: workspace.id, name: workspace.name, handle: workspace.handle }],
    agent: {
      suggested_name: (await firstFreeAgentName(db, workspace.id, agentNameBase(client.clientName))) ?? agentNameBase(client.clientName),
      name_pattern: AGENT_NAME_PATTERN.source,
      reconnect_options: await reconnectOptions(db, workspace.id, client.id),
    },
    scope: { name: 'agent', allows: [...AGENT_SCOPE_COPY.allows], denies: [...AGENT_SCOPE_COPY.denies] },
    extra_scopes: extraScopesView(request.scope, clientDisplay(client).verified),
    plan: await agentLimitState(workspace.id),
  };
}

/** The higher scopes offered on the consent page: all of them while the flag is on, none while it is off. */
function offeredExtras(): readonly ElevatedScope[] {
  return ownerScopeEnabled() ? ELEVATED_SCOPES : [];
}

function extraScopesView(requestScope: string, verified: boolean): ConsentView['extra_scopes'] {
  const asked = new Set(effectiveScopes(requestScope));
  const offered = offeredExtras().map((name) => ({
    name,
    title: ELEVATED_SCOPE_COPY[name].title,
    allows: [...ELEVATED_SCOPE_COPY[name].allows],
    requested_by_client: asked.has(name),
  }));
  const unverified = offered.length > 0 && !verified;
  return {
    offered,
    opt_in_field: 'grant_scopes',
    unverified_client: unverified,
    warning: unverified ? UNVERIFIED_ELEVATED_WARNING : null,
    combined_warning: offered.length > 1 ? COMBINED_ELEVATED_WARNING : null,
    connection_days: offered.length > 0 ? ownerGrantMaxDays() : null,
  };
}

/**
 * §5.10: the scope the user actually grants. Always `agent`, plus each offered higher scope the user ticked
 * (`grant_scopes`), while the flag is on, and never for a disabled client, whether or not the app asked for it.
 * RFC 6749 §3.3 lets the issued scope differ from the requested one; the token response's `scope` says what was
 * granted. Canonical order, no duplicates.
 */
export function grantedScope(ticked: readonly string[], client: Pick<OAuthClientRow, 'disabledAt'>): string {
  const chosen = new Set(ticked);
  const extras = client.disabledAt ? [] : offeredExtras().filter((name) => chosen.has(name));
  return [OAUTH_SCOPE, ...extras].join(' ');
}

export const consentBodySchema = z.discriminatedUnion('decision', [
  z
    .object({
      request_id: z.string().uuid(),
      csrf_token: z.string().min(1).max(200),
      decision: z.literal('allow'),
      workspace_id: z.string().uuid(),
      agent: z.discriminatedUnion('mode', [
        z.object({ mode: z.literal('new'), name: z.string().min(1).max(200) }).strict(),
        z.object({ mode: z.literal('reconnect'), agent_id: z.string().uuid() }).strict(),
      ]),
      /** §5.10: the ticked higher scopes from extra_scopes.offered, each added to `agent`. Absent or []: `agent` only. */
      grant_scopes: z.array(z.enum(ELEVATED_SCOPES)).max(ELEVATED_SCOPES.length).optional(),
    })
    .strict(),
  z
    .object({
      request_id: z.string().uuid(),
      csrf_token: z.string().min(1).max(200),
      decision: z.literal('deny'),
      workspace_id: z.string().uuid().optional(),
    })
    .strict(),
]);

export type ConsentBody = z.infer<typeof consentBodySchema>;

/**
 * POST /api/oauth/consent after the route's Origin, JSON, session and rate-limit checks. Checks the CSRF token and
 * the binding cookie, then completes the request once and returns the client redirect (code or access_denied).
 */
export async function decideConsent(req: Request, user: WorkspaceUser, body: ConsentBody): Promise<{ redirect_to: string }> {
  if (!safeEqualHex(consentCsrfToken(body.request_id, user.id), body.csrf_token.toLowerCase())) {
    throw new HttpError(403, 'csrf_failed', 'This page is out of date. Reload it and try again.');
  }
  const db = getDb();
  const [request] = await db
    .select()
    .from(oauthAuthorizationRequests)
    .where(eq(oauthAuthorizationRequests.id, body.request_id))
    .limit(1);
  if (!request || request.userId !== user.id) throw NOT_FOUND();
  if (!bindingMatches(req, request.bindingHash)) {
    throw new HttpError(403, 'binding_failed', 'Finish connecting in the browser where you started from the app.');
  }
  if (request.completedAt) throw COMPLETED();
  if (request.expiresAt.getTime() <= oauthNow().getTime()) throw EXPIRED();
  const iss = oauthIssuer();

  if (body.decision === 'deny') {
    await completeOnce(db, request.id);
    return { redirect_to: withQuery(request.redirectUri, { error: 'access_denied', state: request.state, iss }) };
  }

  const client = await clientRow(request.clientId);
  const scope = grantedScope(body.grant_scopes ?? [], client);

  if (body.workspace_id !== user.workspace.id) {
    throw new HttpError(400, 'validation_error', 'Choose your workspace.', {
      issues: [{ path: 'workspace_id', message: 'Must be your workspace.' }],
    });
  }
  const workspaceId = user.workspace.id;
  let agent: { mode: 'new'; name: string } | { mode: 'reconnect'; agentId: string };
  if (body.agent.mode === 'new') {
    const name = body.agent.name.trim();
    if (!AGENT_NAME_PATTERN.test(name)) {
      throw new HttpError(
        400,
        'invalid_name',
        'Agent name must start with a letter and contain only letters, numbers, underscores, or hyphens (max 64).',
      );
    }
    const [taken] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.workspaceId, workspaceId), eq(agents.name, name)))
      .limit(1);
    if (taken) {
      throw new HttpError(409, 'name_taken', `An agent named ${name} already exists in this workspace.`, {
        suggested_name: await firstFreeAgentName(db, workspaceId, name),
      });
    }
    const plan = await agentLimitState(workspaceId);
    if (plan.at_agent_limit && plan.agent_limit !== null) {
      throw new HttpError(403, 'plan_limit', planLimitMessage('agents', plan.agent_limit), {
        limit: 'agents',
        max: plan.agent_limit,
      });
    }
    agent = { mode: 'new', name };
  } else {
    if (!(await isReconnectTarget(db, workspaceId, body.agent.agent_id, request.clientId))) {
      throw new HttpError(400, 'validation_error', 'Choose an agent from the list.', {
        issues: [{ path: 'agent.agent_id', message: 'Not an agent this app connected before.' }],
      });
    }
    agent = { mode: 'reconnect', agentId: body.agent.agent_id };
  }

  const code = await db.transaction(async (tx) => {
    await completeOnce(tx, request.id);
    return createAuthorizationCode(tx, {
      clientRowId: request.clientId,
      userId: user.id,
      workspaceId,
      agent,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      scope,
      resource: request.resource,
    });
  });
  return { redirect_to: withQuery(request.redirectUri, { code, state: request.state, iss }) };
}

/** Single use: `update … where completed_at is null returning`. Losing the race is request_completed. */
async function completeOnce(db: Parameters<typeof createAuthorizationCode>[0], requestId: string): Promise<void> {
  const done = await db
    .update(oauthAuthorizationRequests)
    .set({ completedAt: oauthNow() })
    .where(and(eq(oauthAuthorizationRequests.id, requestId), isNull(oauthAuthorizationRequests.completedAt)))
    .returning({ id: oauthAuthorizationRequests.id });
  if (done.length === 0) throw COMPLETED();
}
