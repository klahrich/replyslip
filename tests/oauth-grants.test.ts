import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db';
import { agents, oauthClients, oauthGrants, users, workspaces } from '@/db/schema';
import { revokeAgent } from '@/lib/agents';
import { OAUTH_GRANT_MAX_TTL_MS } from '@/lib/oauth/constants';
import { setCimdFetcherForTests } from '@/lib/oauth/cimd';
import { authenticateClient, clientDisplay, disableClient, readClientCredentials, resolveClient } from '@/lib/oauth/clients';
import { OAuthError } from '@/lib/oauth/errors';
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  failAfterReconnectRevokeForTests,
  firstFreeAgentName,
  pruneOAuth,
  reconnectOptions,
  refreshGrant,
  revokeAgentGrants,
  revokeToken,
} from '@/lib/oauth/grants';
import { setOAuthClockForTests } from '@/lib/oauth/tokens';
import { authenticateOAuthAccessToken } from '@/lib/oauth/verify';
import { usePlanLimitsForTests } from '@/lib/plans';
import { createAgent, signIn } from './helpers';
import { CHATGPT_CLIENT_ID, CLAUDE_CLIENT_ID, CLAUDE_CODE_CLIENT_ID, jsonResponse, pkcePair, stubCimd, CIMD_DOCUMENTS } from './oauth-fixtures';

const RESOURCE = 'https://valetto.tech/api/mcp';
const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

let now = Date.now();

beforeEach(async () => {
  // Client rows are shared by URL; start each test with none (cascades to grants, codes and tokens).
  await getDb().delete(oauthClients);
  now = Date.now();
  setOAuthClockForTests(() => now);
  vi.stubEnv('MCP_OAUTH_ENABLED', '1');
  vi.stubEnv('MCP_OAUTH_ISSUER', 'https://valetto.tech');
  stubCimd();
});

afterEach(() => {
  setOAuthClockForTests(null);
  setCimdFetcherForTests(null);
  failAfterReconnectRevokeForTests(false);
  usePlanLimitsForTests(null);
  vi.unstubAllEnvs();
});

async function expectOAuthError(promise: Promise<unknown>, code: string, description?: RegExp) {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(OAuthError);
  expect((error as OAuthError).code).toBe(code);
  if (description) expect((error as OAuthError).description).toMatch(description);
}

type Owner = Awaited<ReturnType<typeof signIn>>;

async function connect(
  owner: Owner,
  clientId: string,
  redirectUri: string,
  agent: { mode: 'new'; name: string } | { mode: 'reconnect'; agentId: string } = { mode: 'new', name: 'chatgpt' },
) {
  const client = await resolveClient(clientId);
  const { verifier, challenge } = pkcePair();
  const code = await createAuthorizationCode(getDb(), {
    clientRowId: client.id,
    userId: owner.user.id,
    workspaceId: owner.workspace.id,
    agent,
    redirectUri,
    codeChallenge: challenge,
    scope: 'agent',
    resource: RESOURCE,
  });
  const tokens = await exchangeAuthorizationCode({ client, code, codeVerifier: verifier, redirectUri, resource: RESOURCE });
  const principal = await authenticateOAuthAccessToken(tokens.access_token);
  return { client, code, verifier, tokens, principal: principal! };
}

describe('clients', () => {
  it('fetches a CIMD client once, caches it, and refetches after the TTL', async () => {
    const calls = stubCimd();
    const first = await resolveClient(CLAUDE_CLIENT_ID);
    expect(first).toMatchObject({ kind: 'cimd', clientName: 'Claude', tokenEndpointAuthMethod: 'none' });
    await resolveClient(CLAUDE_CLIENT_ID);
    expect(calls.get(CLAUDE_CLIENT_ID)).toBe(1);
    now += 301_000;
    await resolveClient(CLAUDE_CLIENT_ID);
    expect(calls.get(CLAUDE_CLIENT_ID)).toBe(2);
    expect(clientDisplay(first)).toEqual({
      display_name: 'claude.ai',
      client_name: 'Claude',
      verified: true,
      kind: 'cimd',
      client_uri_host: 'claude.ai',
      logo_url: null,
    });
  });

  it('keeps a cached copy under 7 days old when a refetch fails, and refuses an older one', async () => {
    await resolveClient(CLAUDE_CODE_CLIENT_ID);
    stubCimd({ [CLAUDE_CODE_CLIENT_ID]: new Error('network down') });
    now += 2 * 24 * 60 * 60 * 1000;
    const stale = await resolveClient(CLAUDE_CODE_CLIENT_ID);
    expect(stale.clientName).toBe('Claude Code');
    now += 6 * 24 * 60 * 60 * 1000;
    await expectOAuthError(resolveClient(CLAUDE_CODE_CLIENT_ID), 'invalid_client');
  });

  it('refuses unknown, non-allowlisted, disabled and malformed clients', async () => {
    await expectOAuthError(resolveClient('https://evil.example/client.json'), 'invalid_client');
    await expectOAuthError(resolveClient('rsdc_unknown'), 'invalid_client');
    await expectOAuthError(resolveClient('plain-client'), 'invalid_client');
    await expectOAuthError(resolveClient(undefined), 'invalid_client');
    vi.stubEnv('MCP_OAUTH_CIMD_HOSTS', 'claude.ai');
    await expectOAuthError(resolveClient(CHATGPT_CLIENT_ID), 'invalid_client');
    vi.stubEnv('MCP_OAUTH_CIMD_HOSTS', '');
    const chatgpt = await resolveClient(CHATGPT_CLIENT_ID);
    await disableClient(chatgpt.id);
    await expectOAuthError(resolveClient(CHATGPT_CLIENT_ID), 'invalid_client');
  });

  it('refuses a document whose client_id does not match', async () => {
    stubCimd({
      [CLAUDE_CLIENT_ID]: jsonResponse({ ...CIMD_DOCUMENTS[CLAUDE_CLIENT_ID], client_id: CHATGPT_CLIENT_ID }),
    });
    await expectOAuthError(resolveClient(CLAUDE_CLIENT_ID), 'invalid_client');
  });

  it('authenticates a public client by client_id alone and refuses a secret for it', async () => {
    await resolveClient(CLAUDE_CLIENT_ID);
    const form = new URLSearchParams({ client_id: CLAUDE_CLIENT_ID });
    const client = await authenticateClient(readClientCredentials(null, form));
    expect(client.clientId).toBe(CLAUDE_CLIENT_ID);
    form.set('client_secret', 'x');
    await expectOAuthError(authenticateClient(readClientCredentials(null, form)), 'invalid_client');
  });
});

describe('code exchange', () => {
  it('creates the agent, issues tokens, and maps the token to that agent', async () => {
    const owner = await signIn();
    const { tokens, principal } = await connect(owner, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT);
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'agent' });
    expect(tokens.access_token).toMatch(/^rsoa_[A-Za-z0-9_-]{43}$/);
    expect(tokens.refresh_token).toMatch(/^rsor_[A-Za-z0-9_-]{43}$/);
    expect(principal).toMatchObject({ workspaceId: owner.workspace.id, agentName: 'chatgpt', clientId: CHATGPT_CLIENT_ID });
    expect(principal.keyId).toBe(`oauth:${principal.grantId}`);
    const [agent] = await getDb().select().from(agents).where(eq(agents.id, principal.agentId));
    expect(agent).toMatchObject({
      name: 'chatgpt',
      deliveryMode: 'none',
      description: "Connected app: ChatGPT (OAuth). Reads tasks; can't complete them.",
    });
    const [grant] = await getDb().select().from(oauthGrants).where(eq(oauthGrants.id, principal.grantId));
    expect(grant!.agentCreated).toBe(true);
    expect(grant!.absoluteExpiresAt.getTime() - grant!.createdAt.getTime()).toBe(OAUTH_GRANT_MAX_TTL_MS);
  });

  it('dedupes the agent name with -2 … -9', async () => {
    const owner = await signIn();
    await createAgent(owner.cookie, 'chatgpt');
    const second = await connect(owner, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT);
    expect(second.principal.agentName).toBe('chatgpt-2');
    expect(await firstFreeAgentName(getDb(), owner.workspace.id, 'chatgpt')).toBe('chatgpt-3');
  });

  it('is single use, and a reused code revokes the grant it created', async () => {
    const owner = await signIn();
    const first = await connect(owner, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT);
    await expectOAuthError(
      exchangeAuthorizationCode({
        client: first.client,
        code: first.code,
        codeVerifier: first.verifier,
        redirectUri: CHATGPT_REDIRECT,
        resource: null,
      }),
      'invalid_grant',
    );
    const [grant] = await getDb().select().from(oauthGrants).where(eq(oauthGrants.id, first.principal.grantId));
    expect(grant!.revokedReason).toBe('code_reuse');
    expect(await authenticateOAuthAccessToken(first.tokens.access_token)).toBeNull();
  });

  it('refuses a wrong verifier, redirect, client, resource, or an expired code', async () => {
    const owner = await signIn();
    const client = await resolveClient(CHATGPT_CLIENT_ID);
    const other = await resolveClient(CLAUDE_CLIENT_ID);
    const { verifier, challenge } = pkcePair();
    const mint = () =>
      createAuthorizationCode(getDb(), {
        clientRowId: client.id,
        userId: owner.user.id,
        workspaceId: owner.workspace.id,
        agent: { mode: 'new', name: 'chatgpt' },
        redirectUri: CHATGPT_REDIRECT,
        codeChallenge: challenge,
        scope: 'agent',
        resource: RESOURCE,
      });
    const code = await mint();
    const base = { client, code, codeVerifier: verifier, redirectUri: CHATGPT_REDIRECT, resource: null };
    await expectOAuthError(exchangeAuthorizationCode({ ...base, codeVerifier: pkcePair().verifier }), 'invalid_grant');
    await expectOAuthError(exchangeAuthorizationCode({ ...base, redirectUri: `${CHATGPT_REDIRECT}/` }), 'invalid_grant');
    await expectOAuthError(exchangeAuthorizationCode({ ...base, client: other }), 'invalid_grant');
    await expectOAuthError(
      exchangeAuthorizationCode({ ...base, resource: 'https://evil.example/api/mcp' }),
      'invalid_target',
    );
    await expectOAuthError(exchangeAuthorizationCode({ ...base, code: 'rsoc_nope' }), 'invalid_grant');
    // None of the failures consumed the code.
    const ok = await exchangeAuthorizationCode({ ...base, resource: 'HTTPS://valetto.tech/api/mcp/' });
    expect(ok.access_token).toMatch(/^rsoa_/);
    const late = await mint();
    now += 5 * 60 * 1000 + 1;
    await expectOAuthError(exchangeAuthorizationCode({ ...base, code: late }), 'invalid_grant');
  });

  it('counts toward the plan agent limit', async () => {
    const owner = await signIn();
    usePlanLimitsForTests({ agents: 1, tasksPerMonth: null });
    await createAgent(owner.cookie, 'local-bot');
    const client = await resolveClient(CHATGPT_CLIENT_ID);
    const { verifier, challenge } = pkcePair();
    const code = await createAuthorizationCode(getDb(), {
      clientRowId: client.id,
      userId: owner.user.id,
      workspaceId: owner.workspace.id,
      agent: { mode: 'new', name: 'chatgpt' },
      redirectUri: CHATGPT_REDIRECT,
      codeChallenge: challenge,
      scope: 'agent',
      resource: RESOURCE,
    });
    await expectOAuthError(
      exchangeAuthorizationCode({ client, code, codeVerifier: verifier, redirectUri: CHATGPT_REDIRECT, resource: null }),
      'invalid_grant',
      /Workspace agent limit reached/,
    );
    const rows = await getDb().select().from(agents).where(eq(agents.workspaceId, owner.workspace.id));
    expect(rows.map((row) => row.name)).toEqual(['local-bot']);
  });
});

describe('refresh', () => {
  it('rotates, keeps the old access token valid, and narrows scope only to a subset', async () => {
    const owner = await signIn();
    const { client, tokens } = await connect(owner, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT, { mode: 'new', name: 'claude' });
    const next = await refreshGrant({ client, refreshToken: tokens.refresh_token!, scope: 'agent', resource: RESOURCE });
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(await authenticateOAuthAccessToken(tokens.access_token)).not.toBeNull();
    expect(await authenticateOAuthAccessToken(next.access_token)).not.toBeNull();
    await expectOAuthError(
      refreshGrant({ client, refreshToken: next.refresh_token!, scope: 'agent agent:owner', resource: null }),
      'invalid_scope',
    );
    await expectOAuthError(
      refreshGrant({ client, refreshToken: next.refresh_token!, scope: null, resource: 'https://evil.example/api/mcp' }),
      'invalid_target',
    );
    const other = await resolveClient(CHATGPT_CLIENT_ID);
    await expectOAuthError(
      refreshGrant({ client: other, refreshToken: next.refresh_token!, scope: null, resource: null }),
      'invalid_grant',
    );
  });

  it('treats reuse inside 2 s with the child unused as a race: invalid_grant, no revoke', async () => {
    const owner = await signIn();
    const { client, tokens } = await connect(owner, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT, { mode: 'new', name: 'claude' });
    const r2 = await refreshGrant({ client, refreshToken: tokens.refresh_token!, scope: null, resource: null });
    now += 1_000;
    await expectOAuthError(
      refreshGrant({ client, refreshToken: tokens.refresh_token!, scope: null, resource: null }),
      'invalid_grant',
    );
    expect(await authenticateOAuthAccessToken(r2.access_token)).not.toBeNull();
    const r3 = await refreshGrant({ client, refreshToken: r2.refresh_token!, scope: null, resource: null });
    expect(r3.access_token).toMatch(/^rsoa_/);
  });

  it('revokes the grant when R1→R2→R3 and then R1 comes back inside the window (stolen token)', async () => {
    const owner = await signIn();
    const { client, tokens, principal } = await connect(owner, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT, {
      mode: 'new',
      name: 'claude',
    });
    const r2 = await refreshGrant({ client, refreshToken: tokens.refresh_token!, scope: null, resource: null });
    const r3 = await refreshGrant({ client, refreshToken: r2.refresh_token!, scope: null, resource: null });
    now += 500;
    await expectOAuthError(
      refreshGrant({ client, refreshToken: tokens.refresh_token!, scope: null, resource: null }),
      'invalid_grant',
    );
    expect(await authenticateOAuthAccessToken(r3.access_token)).toBeNull();
    const [grant] = await getDb().select().from(oauthGrants).where(eq(oauthGrants.id, principal.grantId));
    expect(grant!.revokedReason).toBe('refresh_reuse');
  });

  it('revokes the grant on reuse after 2 s, and its access tokens stop working', async () => {
    const owner = await signIn();
    const { client, tokens, principal } = await connect(owner, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT, {
      mode: 'new',
      name: 'claude',
    });
    const r2 = await refreshGrant({ client, refreshToken: tokens.refresh_token!, scope: null, resource: null });
    now += 2_001;
    await expectOAuthError(
      refreshGrant({ client, refreshToken: tokens.refresh_token!, scope: null, resource: null }),
      'invalid_grant',
    );
    const [grant] = await getDb().select().from(oauthGrants).where(eq(oauthGrants.id, principal.grantId));
    expect(grant!.revokedReason).toBe('refresh_reuse');
    expect(await authenticateOAuthAccessToken(r2.access_token)).toBeNull();
    await expectOAuthError(
      refreshGrant({ client, refreshToken: r2.refresh_token!, scope: null, resource: null }),
      'invalid_grant',
    );
  });

  it('expires after 30 idle days and at the 365-day absolute limit', async () => {
    const owner = await signIn();
    const { client, tokens } = await connect(owner, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT, { mode: 'new', name: 'claude' });
    now += 31 * 24 * 60 * 60 * 1000;
    await expectOAuthError(
      refreshGrant({ client, refreshToken: tokens.refresh_token!, scope: null, resource: null }),
      'invalid_grant',
    );
    expect(await authenticateOAuthAccessToken(tokens.access_token)).toBeNull();

    now = Date.now();
    const second = await connect(owner, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT, { mode: 'new', name: 'claude-b' });
    let refresh = second.tokens.refresh_token!;
    for (let day = 0; day < 365; day += 29) {
      now += 29 * 24 * 60 * 60 * 1000;
      if (now - Date.now() >= OAUTH_GRANT_MAX_TTL_MS) break;
      refresh = (await refreshGrant({ client, refreshToken: refresh, scope: null, resource: null })).refresh_token!;
    }
    now = Date.now() + OAUTH_GRANT_MAX_TTL_MS + 1000;
    await expectOAuthError(refreshGrant({ client, refreshToken: refresh, scope: null, resource: null }), 'invalid_grant');
  });
});

describe('reconnect', () => {
  it('revokes only the same client’s grants on the agent, in one transaction', async () => {
    const owner = await signIn();
    const first = await connect(owner, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT);
    const agentId = first.principal.agentId;
    const secondChatgpt = await connect(owner, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT, { mode: 'reconnect', agentId });
    expect(await authenticateOAuthAccessToken(first.tokens.access_token)).toBeNull();
    // A second live ChatGPT grant on A, forced back on, so the reconnect below has two to revoke.
    await getDb()
      .update(oauthGrants)
      .set({ revokedAt: null, revokedReason: null })
      .where(eq(oauthGrants.id, first.principal.grantId));
    const claude = await connect(owner, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT, { mode: 'reconnect', agentId });
    expect(await authenticateOAuthAccessToken(first.tokens.access_token)).not.toBeNull();

    failAfterReconnectRevokeForTests(true);
    await expect(connect(owner, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT, { mode: 'reconnect', agentId })).rejects.toThrow(
      /injected failure/,
    );
    failAfterReconnectRevokeForTests(false);
    expect(await authenticateOAuthAccessToken(first.tokens.access_token)).not.toBeNull();
    expect(await authenticateOAuthAccessToken(secondChatgpt.tokens.access_token)).not.toBeNull();

    const third = await connect(owner, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT, { mode: 'reconnect', agentId });
    expect(third.principal.agentId).toBe(agentId);
    expect(await authenticateOAuthAccessToken(first.tokens.access_token)).toBeNull();
    expect(await authenticateOAuthAccessToken(secondChatgpt.tokens.access_token)).toBeNull();
    await expectOAuthError(
      refreshGrant({ client: first.client, refreshToken: secondChatgpt.tokens.refresh_token!, scope: null, resource: null }),
      'invalid_grant',
    );
    expect(await authenticateOAuthAccessToken(claude.tokens.access_token)).not.toBeNull();
    const reasons = await getDb()
      .select({ reason: oauthGrants.revokedReason })
      .from(oauthGrants)
      .where(and(eq(oauthGrants.agentId, agentId), eq(oauthGrants.revokedReason, 'reconnected')));
    // Both ChatGPT grants on A (the first one was forced live again above), never the Claude grant.
    expect(reasons.length).toBe(2);
    const options = await reconnectOptions(getDb(), owner.workspace.id);
    expect(options.map((option) => option.id)).toEqual([agentId]);
  });

  it('refuses to attach to an agent no OAuth grant created', async () => {
    const owner = await signIn();
    const bot = await createAgent(owner.cookie, 'local-bot');
    await expectOAuthError(
      connect(owner, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT, { mode: 'reconnect', agentId: bot.id }),
      'invalid_grant',
    );
    expect(await reconnectOptions(getDb(), owner.workspace.id)).toEqual([]);
  });
});

describe('authenticateOAuthAccessToken', () => {
  it('returns null for a wrong audience, revoked agent, revoked grant, disabled client, or a user who left', async () => {
    const owner = await signIn();
    const a = await connect(owner, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT);
    vi.stubEnv('MCP_OAUTH_ISSUER', 'https://other.example');
    expect(await authenticateOAuthAccessToken(a.tokens.access_token)).toBeNull();
    vi.stubEnv('MCP_OAUTH_ISSUER', 'https://valetto.tech');
    expect(await authenticateOAuthAccessToken(a.tokens.access_token)).not.toBeNull();
    expect(await authenticateOAuthAccessToken('rsk_not_oauth')).toBeNull();

    await revokeAgent(owner.workspace.id, a.principal.agentId);
    expect(await authenticateOAuthAccessToken(a.tokens.access_token)).toBeNull();

    const b = await connect(owner, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT, { mode: 'new', name: 'chatgpt-b' });
    expect(await revokeAgentGrants(getDb(), b.principal.agentId)).toBe(1);
    expect(await authenticateOAuthAccessToken(b.tokens.access_token)).toBeNull();

    const c = await connect(owner, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT, { mode: 'new', name: 'claude' });
    await disableClient(c.client.id);
    expect(await authenticateOAuthAccessToken(c.tokens.access_token)).toBeNull();
    await getDb().update(oauthClients).set({ disabledAt: null }).where(eq(oauthClients.id, c.client.id));
    expect(await authenticateOAuthAccessToken(c.tokens.access_token)).toBeNull(); // grant revoked by the kill switch

    const d = await connect(owner, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT, { mode: 'new', name: 'claude-d' });
    const elsewhere = await signIn();
    await getDb().update(users).set({ workspaceId: elsewhere.workspace.id }).where(eq(users.id, owner.user.id));
    expect(await authenticateOAuthAccessToken(d.tokens.access_token)).toBeNull();
    const [grant] = await getDb().select().from(oauthGrants).where(eq(oauthGrants.id, d.principal.grantId));
    expect(grant!.revokedReason).toBe('user_left_workspace');
    await getDb().update(users).set({ workspaceId: owner.workspace.id }).where(eq(users.id, owner.user.id));
  });

  it('expires an access token after an hour', async () => {
    const owner = await signIn();
    const { tokens } = await connect(owner, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT);
    now += 60 * 60 * 1000 + 1;
    expect(await authenticateOAuthAccessToken(tokens.access_token)).toBeNull();
  });
});

describe('revokeToken', () => {
  it('revokes the grant for a refresh token, only itself for an access token, and ignores other clients', async () => {
    const owner = await signIn();
    const a = await connect(owner, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT);
    const second = await refreshGrant({ client: a.client, refreshToken: a.tokens.refresh_token!, scope: null, resource: null });
    await revokeToken({ client: a.client, token: a.tokens.access_token, hint: 'access_token' });
    expect(await authenticateOAuthAccessToken(a.tokens.access_token)).toBeNull();
    expect(await authenticateOAuthAccessToken(second.access_token)).not.toBeNull();

    const claude = await resolveClient(CLAUDE_CLIENT_ID);
    await revokeToken({ client: claude, token: second.refresh_token!, hint: null });
    expect(await authenticateOAuthAccessToken(second.access_token)).not.toBeNull();
    await revokeToken({ client: claude, token: 'rsor_unknown', hint: 'refresh_token' });

    await revokeToken({ client: a.client, token: second.refresh_token!, hint: null });
    expect(await authenticateOAuthAccessToken(second.access_token)).toBeNull();
    const [grant] = await getDb().select().from(oauthGrants).where(eq(oauthGrants.id, a.principal.grantId));
    expect(grant!.revokedReason).toBe('user');
  });
});

describe('pruneOAuth', () => {
  it('deletes expired rows and keeps live ones', async () => {
    const owner = await signIn();
    const live = await connect(owner, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT);
    const old = await connect(owner, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT, { mode: 'new', name: 'claude' });
    await refreshGrant({ client: old.client, refreshToken: old.tokens.refresh_token!, scope: null, resource: null });
    now += 40 * 24 * 60 * 60 * 1000;
    const pruned = await pruneOAuth();
    // Access tokens (2 + 1 from the refresh) and codes are past expiry + 1 day. Of the refresh rows, only the one
    // rotated 40 days ago is gone; the unrotated ones expired 10 days ago, inside the 30-day keep window.
    expect(pruned).toMatchObject({ accessTokens: 3, codes: 2, refreshTokens: 1, requests: 0, clients: 0 });
    const [stillThere] = await getDb().select().from(oauthGrants).where(eq(oauthGrants.id, live.principal.grantId));
    expect(stillThere).toBeTruthy();
    const ws = await getDb().select().from(workspaces).where(eq(workspaces.id, owner.workspace.id));
    expect(ws.length).toBe(1);
  });
});
