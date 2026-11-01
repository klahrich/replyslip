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
import { oauthIssuer } from './config';
import { agentNameBase, createAuthorizationCode, firstFreeAgentName, isReconnectTarget, reconnectOptions } from './grants';
import { isLoopbackHost, redirectHost, withQuery } from './redirect';
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
  redirect: { host: string; loopback: boolean };
  user: { email: string };
  workspaces: Array<{ id: string; name: string; handle: string | null }>;
  agent: {
    suggested_name: string;
    name_pattern: string;
    reconnect_options: Array<{ id: string; name: string; last_connected_at: string | null }>;
  };
  scope: { name: 'agent'; allows: string[]; denies: string[] };
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
    redirect: { host, loopback: isLoopbackHost(host) },
    user: { email: user.email },
    workspaces: [{ id: workspace.id, name: workspace.name, handle: workspace.handle }],
    agent: {
      suggested_name: (await firstFreeAgentName(db, workspace.id, agentNameBase(client.clientName))) ?? agentNameBase(client.clientName),
      name_pattern: AGENT_NAME_PATTERN.source,
      reconnect_options: await reconnectOptions(db, workspace.id, client.id),
    },
    scope: { name: 'agent', allows: [...AGENT_SCOPE_COPY.allows], denies: [...AGENT_SCOPE_COPY.denies] },
    plan: await agentLimitState(workspace.id),
  };
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
      scope: request.scope,
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
