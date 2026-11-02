import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb, type Db, type DbTx } from '@/db';
import {
  agents,
  oauthAccessTokens,
  oauthAuthorizationCodes,
  oauthAuthorizationRequests,
  oauthClients,
  oauthGrants,
  oauthRefreshTokens,
  users,
  type OAuthClientRow,
} from '@/db/schema';
import { AGENT_NAME_PATTERN } from '../constants';
import {
  OAUTH_ACCESS_TOKEN_TTL_MS,
  OAUTH_CODE_TTL_MS,
  OAUTH_DCR_IDLE_TTL_MS,
  OAUTH_DCR_UNUSED_TTL_MS,
  OAUTH_GRANT_MAX_TTL_MS,
  OAUTH_REFRESH_IDLE_TTL_MS,
  OAUTH_REFRESH_RACE_WINDOW_MS,
} from './constants';
import { sha256 } from '../crypto';
import { isUniqueViolation } from '../errors';
import { agentCountForUpdate, loadFirstAgentNotice, queueFirstAgentAlert, type FirstAgentNotice } from '../first-agent-alert';
import { PlanLimitError, assertWithinLimit } from '../plans';
import { SCOPE_RESPOND, effectiveScopes, grantableScope, isElevatedScope, normalizeResource, ownerGrantMaxDays } from './config';
import { OAuthError } from './errors';
import { isValidCodeVerifier, verifyPkce } from './pkce';
import { hasPrefix, mintToken, oauthNow } from './tokens';

/**
 * Grants, codes and tokens (docs/design/mcp-oauth.md §2.7, §2.8, §3, §5.8). Every timestamp comes from oauthNow(),
 * so tests can step the clock. Errors are OAuthError with fixed copy; nothing here logs a token or code.
 */

export type RevokedReason =
  | 'user'
  | 'agent_revoked'
  | 'refresh_reuse'
  | 'code_reuse'
  | 'client_disabled'
  | 'user_left_workspace'
  | 'reconnected';

export type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...fields }));
}

const MAX_NAME_SUFFIX = 9;

/** "Claude Code" → "claude-code". Falls back to "app" when nothing usable is left. */
export function agentNameBase(clientName: string): string {
  const base = clientName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return base && AGENT_NAME_PATTERN.test(base) ? base : 'app';
}

function nameCandidates(base: string): string[] {
  const out = [base];
  for (let n = 2; n <= MAX_NAME_SUFFIX; n += 1) out.push(`${base.slice(0, 64 - String(n).length - 1)}-${n}`);
  return out;
}

/** The first of base, base-2 … base-9 that no agent in the workspace holds (revoked agents keep their names). */
export async function firstFreeAgentName(db: Db, workspaceId: string, base: string): Promise<string | null> {
  const candidates = nameCandidates(base);
  const taken = await db
    .select({ name: agents.name })
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), inArray(agents.name, candidates)));
  const names = new Set(taken.map((row) => row.name));
  return candidates.find((name) => !names.has(name)) ?? null;
}

export function connectedAppDescription(clientName: string, scope = 'agent'): string {
  return scope.split(' ').includes(SCOPE_RESPOND)
    ? `Connected app: ${clientName} (OAuth). Can work on tasks sent to it.`
    : `Connected app: ${clientName} (OAuth). Reads tasks; can't complete them.`;
}

/**
 * §5.10: a connection that holds a higher scope lasts MCP_OAUTH_OWNER_MAX_DAYS (default 30) instead of 365 days, so
 * refresh tokens stop then too and the user approves again.
 */
export function grantLifetimeMs(scope: string): number {
  const elevated = scope.split(' ').some(isElevatedScope);
  return elevated ? Math.min(OAUTH_GRANT_MAX_TTL_MS, ownerGrantMaxDays() * 24 * 60 * 60 * 1000) : OAUTH_GRANT_MAX_TTL_MS;
}

/** Agents in the workspace that an earlier OAuth grant created and that are still active, newest connection first. */
/** The agent was created by some OAuth grant (never an rsk_ bot). Correlated on the outer agents row. */
function createdByOAuth() {
  return sql`exists (select 1 from oauth_grants created where created.agent_id = ${agents.id} and created.agent_created)`;
}

/**
 * Reconnect choices: active connected-app agents this same client app connected before (any grant from it on the
 * agent, live or ended), newest first. Agents only another app connected are not offered.
 */
export async function reconnectOptions(
  db: Db,
  workspaceId: string,
  clientRowId: string,
): Promise<Array<{ id: string; name: string; last_connected_at: string | null }>> {
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      lastConnected: sql<Date | string | null>`max(coalesce(${oauthGrants.lastUsedAt}, ${oauthGrants.createdAt}))`,
    })
    .from(oauthGrants)
    .innerJoin(agents, eq(agents.id, oauthGrants.agentId))
    .where(
      and(
        eq(oauthGrants.workspaceId, workspaceId),
        eq(oauthGrants.clientId, clientRowId),
        createdByOAuth(),
        eq(agents.workspaceId, workspaceId),
        eq(agents.role, 'agent'),
        isNull(agents.revokedAt),
      ),
    )
    .groupBy(agents.id, agents.name)
    .orderBy(desc(sql`max(${oauthGrants.createdAt})`));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    last_connected_at: row.lastConnected ? new Date(row.lastConnected).toISOString() : null,
  }));
}

/** Is this agent a valid "Reconnect as" target: active, in the workspace, created by an earlier OAuth grant? */
export async function isReconnectTarget(
  db: Db,
  workspaceId: string,
  agentId: string,
  clientRowId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .innerJoin(oauthGrants, eq(oauthGrants.agentId, agents.id))
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.workspaceId, workspaceId),
        eq(agents.role, 'agent'),
        isNull(agents.revokedAt),
        eq(oauthGrants.workspaceId, workspaceId),
        eq(oauthGrants.clientId, clientRowId),
        createdByOAuth(),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export type CodeInput = {
  clientRowId: string;
  userId: string;
  workspaceId: string;
  agent: { mode: 'new'; name: string } | { mode: 'reconnect'; agentId: string };
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
};

/** Mint a 5-minute single-use code. Returns the plaintext code; only its hash is stored. */
export async function createAuthorizationCode(db: Db, input: CodeInput): Promise<string> {
  const { token, hash } = mintToken('code');
  await db.insert(oauthAuthorizationCodes).values({
    codeHash: hash,
    clientId: input.clientRowId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    agentId: input.agent.mode === 'reconnect' ? input.agent.agentId : null,
    newAgentName: input.agent.mode === 'new' ? input.agent.name : null,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: input.scope,
    resource: input.resource,
    expiresAt: new Date(oauthNow().getTime() + OAUTH_CODE_TTL_MS),
  });
  return token;
}

function issuesRefresh(client: OAuthClientRow): boolean {
  const grants = Array.isArray(client.grantTypes) ? client.grantTypes : null;
  return grants === null || grants.length === 0 || grants.includes('refresh_token');
}

async function insertTokens(
  tx: DbTx,
  grant: { id: string; absoluteExpiresAt: Date; scope: string },
  options: { refresh: boolean; parentId?: string },
): Promise<TokenResponse> {
  const now = oauthNow();
  const access = mintToken('access');
  await tx.insert(oauthAccessTokens).values({
    grantId: grant.id,
    tokenHash: access.hash,
    expiresAt: new Date(Math.min(now.getTime() + OAUTH_ACCESS_TOKEN_TTL_MS, grant.absoluteExpiresAt.getTime())),
    createdAt: now,
  });
  const response: TokenResponse = {
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: Math.max(
      1,
      Math.floor(Math.min(OAUTH_ACCESS_TOKEN_TTL_MS, grant.absoluteExpiresAt.getTime() - now.getTime()) / 1000),
    ),
    // What the token can do now: with MCP_OAUTH_OWNER_SCOPE off, higher scopes on an older grant don't count (verify.ts).
    scope: effectiveScopes(grant.scope).join(' '),
  };
  if (options.refresh) {
    const refresh = mintToken('refresh');
    await tx.insert(oauthRefreshTokens).values({
      grantId: grant.id,
      tokenHash: refresh.hash,
      parentId: options.parentId ?? null,
      expiresAt: new Date(Math.min(now.getTime() + OAUTH_REFRESH_IDLE_TTL_MS, grant.absoluteExpiresAt.getTime())),
      createdAt: now,
    });
    response.refresh_token = refresh.token;
  }
  return response;
}

/** Revoke one grant (idempotent). Every token joins the grant, so all of them stop working at once. */
export async function revokeGrant(db: Db, grantId: string, reason: RevokedReason): Promise<boolean> {
  const rows = await db
    .update(oauthGrants)
    .set({ revokedAt: oauthNow(), revokedReason: reason })
    .where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt)))
    .returning({ id: oauthGrants.id });
  return rows.length > 0;
}

/** §5.8: revoking an agent revokes every grant on it, in the caller's transaction. */
export async function revokeAgentGrants(tx: Db, agentId: string): Promise<number> {
  const rows = await tx
    .update(oauthGrants)
    .set({ revokedAt: oauthNow(), revokedReason: 'agent_revoked' })
    .where(and(eq(oauthGrants.agentId, agentId), isNull(oauthGrants.revokedAt)))
    .returning({ id: oauthGrants.id });
  return rows.length;
}

export type CodeExchangeInput = {
  client: OAuthClientRow;
  code: string | null;
  codeVerifier: string | null;
  redirectUri: string | null;
  resource: string | null;
};

type ExchangeOutcome =
  | { kind: 'ok'; response: TokenResponse; notice: FirstAgentNotice | null; grantId: string; reconnected: number }
  | { kind: 'reuse'; grantId: string | null };

/** For tests: throw after the reconnect revoke, to prove the transaction rolls back. */
let failAfterReconnectRevoke = false;
export function failAfterReconnectRevokeForTests(on: boolean): void {
  failAfterReconnectRevoke = on;
}

/** grant_type=authorization_code (§2.7). */
export async function exchangeAuthorizationCode(input: CodeExchangeInput): Promise<TokenResponse> {
  const { client } = input;
  if (!input.code || !hasPrefix(input.code, 'code')) throw new OAuthError('invalid_grant', 'The code is not valid.');
  if (!input.redirectUri) throw new OAuthError('invalid_request', 'redirect_uri is required.');
  if (!isValidCodeVerifier(input.codeVerifier)) throw new OAuthError('invalid_grant', 'The code is not valid.');
  const db = getDb();
  const codeHash = sha256(input.code);
  const [code] = await db
    .select()
    .from(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.codeHash, codeHash))
    .limit(1);
  const now = oauthNow();
  if (!code || code.expiresAt.getTime() <= now.getTime()) {
    throw new OAuthError('invalid_grant', 'The code is not valid.');
  }
  if (code.consumedAt) {
    if (code.grantId && (await revokeGrant(db, code.grantId, 'code_reuse'))) {
      logEvent('oauth.code_reuse', { grant: code.grantId });
    }
    throw new OAuthError('invalid_grant', 'The code is not valid.');
  }
  if (
    code.clientId !== client.id ||
    code.redirectUri !== input.redirectUri ||
    !verifyPkce(input.codeVerifier, code.codeChallenge)
  ) {
    throw new OAuthError('invalid_grant', 'The code is not valid.');
  }
  if (input.resource !== null && normalizeResource(input.resource) !== code.resource) {
    throw new OAuthError('invalid_target', 'The resource does not match this code.');
  }

  // The code carries what the user granted at consent. Re-filter in case MCP_OAUTH_OWNER_SCOPE was turned off since,
  // or the client was disabled (resolveClient already refuses those).
  const scope = client.disabledAt ? 'agent' : grantableScope(code.scope);

  let outcome: ExchangeOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<ExchangeOutcome> => {
      const [locked] = await tx
        .select()
        .from(oauthAuthorizationCodes)
        .where(eq(oauthAuthorizationCodes.id, code.id))
        .for('update');
      const consumed = await tx
        .update(oauthAuthorizationCodes)
        .set({ consumedAt: now })
        .where(and(eq(oauthAuthorizationCodes.id, code.id), isNull(oauthAuthorizationCodes.consumedAt)))
        .returning({ id: oauthAuthorizationCodes.id });
      if (!locked || consumed.length === 0) {
        const grantId = locked?.grantId ?? null;
        if (grantId) await revokeGrant(tx, grantId, 'code_reuse');
        return { kind: 'reuse', grantId };
      }
      const [member] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, code.userId), eq(users.workspaceId, code.workspaceId)))
        .limit(1);
      if (!member) throw new OAuthError('invalid_grant', 'The approving user is no longer in this workspace.');

      let agentId: string;
      let agentCreated = false;
      let notice: FirstAgentNotice | null = null;
      let reconnected = 0;
      if (code.agentId) {
        await tx.execute(sql`select id from agents where id = ${code.agentId} for update`);
        if (!(await isReconnectTarget(tx, code.workspaceId, code.agentId, client.id))) {
          throw new OAuthError('invalid_grant', 'The chosen agent is no longer available.');
        }
        const revoked = await tx
          .update(oauthGrants)
          .set({ revokedAt: now, revokedReason: 'reconnected' })
          .where(
            and(
              eq(oauthGrants.agentId, code.agentId),
              eq(oauthGrants.clientId, client.id),
              isNull(oauthGrants.revokedAt),
            ),
          )
          .returning({ id: oauthGrants.id });
        reconnected = revoked.length;
        if (failAfterReconnectRevoke) throw new Error('injected failure after reconnect revoke');
        agentId = code.agentId;
      } else {
        const requested = code.newAgentName ?? 'app';
        await assertWithinLimit(code.workspaceId, 'agents', tx);
        const name = await firstFreeAgentName(tx, code.workspaceId, requested);
        if (!name) throw new OAuthError('invalid_grant', 'That agent name is taken.');
        const prior = await agentCountForUpdate(tx, code.workspaceId);
        const [agent] = await tx
          .insert(agents)
          .values({
            workspaceId: code.workspaceId,
            name,
            description: connectedAppDescription(client.clientName, scope),
          })
          .returning();
        if (!agent) throw new OAuthError('server_error', 'Something went wrong.', 500);
        notice = prior === 0 ? await loadFirstAgentNotice(tx, agent) : null;
        agentId = agent.id;
        agentCreated = true;
      }

      const [grant] = await tx
        .insert(oauthGrants)
        .values({
          clientId: client.id,
          userId: code.userId,
          workspaceId: code.workspaceId,
          agentId,
          agentCreated,
          scope,
          resource: code.resource,
          redirectUri: code.redirectUri,
          absoluteExpiresAt: new Date(now.getTime() + grantLifetimeMs(scope)),
          lastUsedAt: now,
          createdAt: now,
        })
        .returning();
      if (!grant) throw new OAuthError('server_error', 'Something went wrong.', 500);
      await tx.update(oauthAuthorizationCodes).set({ grantId: grant.id }).where(eq(oauthAuthorizationCodes.id, code.id));
      const response = await insertTokens(tx, grant, { refresh: issuesRefresh(client) });
      await tx.update(oauthClients).set({ lastUsedAt: now }).where(eq(oauthClients.id, client.id));
      return { kind: 'ok', response, notice, grantId: grant.id, reconnected };
    });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      throw new OAuthError('invalid_grant', 'Workspace agent limit reached');
    }
    if (isUniqueViolation(error)) throw new OAuthError('invalid_grant', 'That agent name is taken.');
    throw error;
  }
  if (outcome.kind === 'reuse') {
    if (outcome.grantId) logEvent('oauth.code_reuse', { grant: outcome.grantId });
    throw new OAuthError('invalid_grant', 'The code is not valid.');
  }
  if (outcome.reconnected > 0) logEvent('oauth.reconnect', { grant: outcome.grantId, revoked: outcome.reconnected });
  if (outcome.notice) queueFirstAgentAlert(outcome.notice);
  return outcome.response;
}

export type RefreshInput = {
  client: OAuthClientRow;
  refreshToken: string | null;
  scope: string | null;
  resource: string | null;
};

type RefreshOutcome =
  | { kind: 'ok'; response: TokenResponse }
  | { kind: 'reuse'; inWindow: boolean }
  | { kind: 'race' }
  | { kind: 'invalid' };

/** grant_type=refresh_token (§2.7), with rotation and reuse detection. */
export async function refreshGrant(
  input: RefreshInput,
  hooks: { beforeRotate?: (grantId: string) => Promise<void> } = {},
): Promise<TokenResponse> {
  const invalid = () => new OAuthError('invalid_grant', 'The refresh token is not valid.');
  if (!input.refreshToken || !hasPrefix(input.refreshToken, 'refresh')) throw invalid();
  const db = getDb();
  const [found] = await db
    .select({ token: oauthRefreshTokens, grant: oauthGrants })
    .from(oauthRefreshTokens)
    .innerJoin(oauthGrants, eq(oauthGrants.id, oauthRefreshTokens.grantId))
    .where(eq(oauthRefreshTokens.tokenHash, sha256(input.refreshToken)))
    .limit(1);
  const now = oauthNow();
  if (!found) throw invalid();
  const { token, grant } = found;
  if (grant.clientId !== input.client.id) throw invalid();
  if (
    token.revokedAt ||
    grant.revokedAt ||
    grant.absoluteExpiresAt.getTime() <= now.getTime() ||
    (!token.rotatedAt && token.expiresAt.getTime() <= now.getTime())
  ) {
    throw invalid();
  }
  if (input.scope !== null) {
    const granted = new Set(grant.scope.split(' '));
    const asked = input.scope.split(' ').filter(Boolean);
    if (asked.some((scope) => !granted.has(scope))) {
      throw new OAuthError('invalid_scope', 'The requested scope is not part of this grant.');
    }
  }
  if (input.resource !== null && normalizeResource(input.resource) !== grant.resource) {
    throw new OAuthError('invalid_target', 'The resource does not match this grant.');
  }
  if (hooks.beforeRotate) await hooks.beforeRotate(grant.id);

  const outcome = await db.transaction(async (tx): Promise<RefreshOutcome> => {
    const [row] = await tx.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.id, token.id)).for('update');
    if (!row || row.revokedAt) return { kind: 'invalid' };
    if (row.rotatedAt) {
      const [child] = await tx
        .select()
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.parentId, row.id))
        .for('update');
      if (child?.rotatedAt) {
        await revokeGrant(tx, grant.id, 'refresh_reuse');
        return { kind: 'reuse', inWindow: true };
      }
      if (now.getTime() - row.rotatedAt.getTime() <= OAUTH_REFRESH_RACE_WINDOW_MS) return { kind: 'race' };
      await revokeGrant(tx, grant.id, 'refresh_reuse');
      return { kind: 'reuse', inWindow: false };
    }
    const [liveGrant] = await tx
      .select({ id: oauthGrants.id, workspaceId: oauthGrants.workspaceId, revokedAt: oauthGrants.revokedAt })
      .from(oauthGrants)
      .where(eq(oauthGrants.id, grant.id))
      .for('update');
    if (!liveGrant || liveGrant.revokedAt) return { kind: 'invalid' };
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, grant.agentId), eq(agents.workspaceId, grant.workspaceId), isNull(agents.revokedAt)))
      .limit(1);
    if (!agent) return { kind: 'invalid' };
    const [member] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, grant.userId), eq(users.workspaceId, grant.workspaceId)))
      .limit(1);
    if (!member) {
      await revokeGrant(tx, grant.id, 'user_left_workspace');
      return { kind: 'invalid' };
    }
    await tx.update(oauthRefreshTokens).set({ rotatedAt: now }).where(eq(oauthRefreshTokens.id, row.id));
    const response = await insertTokens(tx, grant, { refresh: true, parentId: row.id });
    await tx.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, grant.id));
    return { kind: 'ok', response };
  });
  if (outcome.kind === 'ok') return outcome.response;
  if (outcome.kind === 'race') logEvent('oauth.refresh_race', { grant: grant.id });
  if (outcome.kind === 'reuse') logEvent('oauth.refresh_reuse', { grant: grant.id, in_window: outcome.inWindow });
  throw invalid();
}

/**
 * RFC 7009 (§2.8). Unknown tokens, already revoked tokens and tokens of another client are a silent no-op. A refresh
 * token revokes its grant; an access token revokes only itself.
 */
export async function revokeToken(input: { client: OAuthClientRow; token: string | null; hint: string | null }): Promise<void> {
  const { token } = input;
  if (!token) return;
  const db = getDb();
  const hash = sha256(token);
  const tryRefresh = async () => {
    if (!hasPrefix(token, 'refresh')) return false;
    const [row] = await db
      .select({ grantId: oauthGrants.id, clientId: oauthGrants.clientId })
      .from(oauthRefreshTokens)
      .innerJoin(oauthGrants, eq(oauthGrants.id, oauthRefreshTokens.grantId))
      .where(eq(oauthRefreshTokens.tokenHash, hash))
      .limit(1);
    if (!row) return false;
    if (row.clientId === input.client.id) await revokeGrant(db, row.grantId, 'user');
    return true;
  };
  const tryAccess = async () => {
    if (!hasPrefix(token, 'access')) return false;
    const [row] = await db
      .select({ id: oauthAccessTokens.id, clientId: oauthGrants.clientId })
      .from(oauthAccessTokens)
      .innerJoin(oauthGrants, eq(oauthGrants.id, oauthAccessTokens.grantId))
      .where(eq(oauthAccessTokens.tokenHash, hash))
      .limit(1);
    if (!row) return false;
    if (row.clientId === input.client.id) {
      await db
        .update(oauthAccessTokens)
        .set({ revokedAt: oauthNow() })
        .where(and(eq(oauthAccessTokens.id, row.id), isNull(oauthAccessTokens.revokedAt)));
    }
    return true;
  };
  if (input.hint === 'access_token') {
    if (!(await tryAccess())) await tryRefresh();
  } else if (!(await tryRefresh())) {
    await tryAccess();
  }
}

/**
 * Daily cleanup (§3): expired requests and codes older than a day, access tokens a day past expiry, refresh rows
 * rotated or expired more than 30 days ago, unused DCR clients after 24 h and idle ones after 90 days. A client with
 * an active grant is never deleted. CIMD rows are kept (they are a cache keyed by URL and cost one row each).
 */
export async function pruneOAuth(): Promise<{
  requests: number;
  codes: number;
  accessTokens: number;
  refreshTokens: number;
  clients: number;
}> {
  const db = getDb();
  const now = oauthNow().getTime();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const requests = await db
    .delete(oauthAuthorizationRequests)
    .where(lt(oauthAuthorizationRequests.expiresAt, dayAgo))
    .returning({ id: oauthAuthorizationRequests.id });
  const codes = await db
    .delete(oauthAuthorizationCodes)
    .where(lt(oauthAuthorizationCodes.expiresAt, dayAgo))
    .returning({ id: oauthAuthorizationCodes.id });
  const accessTokens = await db
    .delete(oauthAccessTokens)
    .where(lt(oauthAccessTokens.expiresAt, dayAgo))
    .returning({ id: oauthAccessTokens.id });
  const refreshTokens = await db
    .delete(oauthRefreshTokens)
    .where(or(lt(oauthRefreshTokens.rotatedAt, monthAgo), lt(oauthRefreshTokens.expiresAt, monthAgo)))
    .returning({ id: oauthRefreshTokens.id });
  const unusedBefore = new Date(now - OAUTH_DCR_UNUSED_TTL_MS);
  const idleBefore = new Date(now - OAUTH_DCR_IDLE_TTL_MS);
  const clients = await db
    .delete(oauthClients)
    .where(
      and(
        eq(oauthClients.kind, 'dcr'),
        sql`not exists (select 1 from oauth_grants g where g.client_id = ${oauthClients.id} and g.revoked_at is null and g.absolute_expires_at > ${new Date(now).toISOString()}::timestamptz)`,
        or(
          and(
            lt(oauthClients.createdAt, unusedBefore),
            sql`not exists (select 1 from oauth_grants g where g.client_id = ${oauthClients.id})`,
          ),
          and(
            lt(oauthClients.createdAt, idleBefore),
            or(isNull(oauthClients.lastUsedAt), lt(oauthClients.lastUsedAt, idleBefore)),
          ),
        ),
      ),
    )
    .returning({ id: oauthClients.id });
  return {
    requests: requests.length,
    codes: codes.length,
    accessTokens: accessTokens.length,
    refreshTokens: refreshTokens.length,
    clients: clients.length,
  };
}

