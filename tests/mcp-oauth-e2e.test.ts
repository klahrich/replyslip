import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as asMetadataRoute } from '@/app/.well-known/oauth-authorization-server/route';
import { GET as prmRoute } from '@/app/.well-known/oauth-protected-resource/[[...path]]/route';
import { GET as listConnectedRoute } from '@/app/api/v1/connected-apps/route';
import { POST as disconnectRoute } from '@/app/api/v1/connected-apps/[id]/revoke/route';
import { getDb } from '@/db';
import { agents, messages, oauthClients, oauthGrants, workspaces } from '@/db/schema';
import { revokeAgent } from '@/lib/agents';
import { setCimdFetcherForTests } from '@/lib/oauth/cimd';
import { setOAuthClockForTests } from '@/lib/oauth/tokens';
import { mcpAuthHandler } from '@/lib/mcp-server';
import { call, createAgent, createKey, mcpTool, signIn } from './helpers';
import { CLAUDE_CLIENT_ID, stubCimd } from './oauth-fixtures';
import { CLAUDE_REDIRECT, ISSUER, RESOURCE, connect, postConsent, register, startConnect, token } from './oauth-flow';

/** docs/design/mcp-oauth.md §7: a fake MCP client (Claude, via CIMD) end to end through the real route handlers. */

const RESULT_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
const CLAUDE = { client_id: CLAUDE_CLIENT_ID, redirect_uri: CLAUDE_REDIRECT };
let now = Date.now();

beforeEach(async () => {
  await getDb().delete(oauthClients);
  now = Date.now();
  setOAuthClockForTests(() => now);
  vi.stubEnv('MCP_OAUTH_ENABLED', '1');
  vi.stubEnv('MCP_OAUTH_ISSUER', ISSUER);
  stubCimd();
});

afterEach(() => {
  setOAuthClockForTests(null);
  setCimdFetcherForTests(null);
  vi.unstubAllEnvs();
});

async function mcpPost(bearer: string | null, body: unknown) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    // A forged forwarded host must not leak into the challenge.
    'x-forwarded-host': 'evil.example',
  };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return mcpAuthHandler(new Request('http://localhost/api/mcp', { method: 'POST', headers, body: JSON.stringify(body) }));
}

function challenge(res: Response): Record<string, string> {
  const header = res.headers.get('www-authenticate') ?? '';
  return Object.fromEntries([...header.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
}

async function workspaceSnapshot(workspaceId: string) {
  const db = getDb();
  return JSON.stringify({
    workspace: await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)),
    agents: await db.select().from(agents).where(eq(agents.workspaceId, workspaceId)).orderBy(agents.name),
    messages: await db.select().from(messages).where(eq(messages.workspaceId, workspaceId)),
  });
}

describe('MCP OAuth end to end (fake Claude client)', () => {
  it('discovers, authorizes, consents, exchanges, calls tools, refreshes, revokes', async () => {
    // 1. Unauthenticated MCP call: 401 with the fixed-issuer resource_metadata and scope="agent".
    const unauth = await mcpPost(null, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(unauth.status).toBe(401);
    const params = challenge(unauth);
    expect(params.resource_metadata).toBe(`${ISSUER}/.well-known/oauth-protected-resource/api/mcp`);
    expect(params.scope).toBe('agent');

    // 2. PRM and AS metadata.
    const prm = await call(prmRoute, params.resource_metadata!, { params: { path: ['api', 'mcp'] } as never });
    expect(prm.status).toBe(200);
    expect(prm.data.resource).toBe(RESOURCE);
    expect(prm.data.authorization_servers).toEqual([ISSUER]);
    const as = await call(asMetadataRoute, `${ISSUER}/.well-known/oauth-authorization-server`);
    expect(as.status).toBe(200);
    expect(as.data.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.data.token_endpoint_auth_methods_supported).toContain('none');
    expect(as.data.client_id_metadata_document_supported).toBe(true);
    expect(as.data.authorization_response_iss_parameter_supported).toBe(true);
    // 3a. DCR is deferred (PR 3): not advertised while MCP_OAUTH_DCR is off.
    expect(as.data.registration_endpoint).toBeUndefined();

    // 3b–5. CIMD client, /authorize (302 + binding cookie), consent data.
    const owner = await signIn();
    const other = await createAgent(owner.cookie, 'helper');
    const otherKey = await createKey(owner.cookie, other.id);
    const started = await startConnect(owner, CLAUDE);
    expect(started.view.redirect.host).toBe('claude.ai');
    expect(started.view.client.verified).toBe(true);
    expect(started.view.agent.suggested_name).toBe('claude');
    expect(started.view.agent.reconnect_options).toEqual([]);

    // 6. Allow: redirect_to carries code, the same state, and iss.
    const decided = await postConsent(
      owner,
      {
        request_id: started.view.request_id,
        csrf_token: started.view.csrf_token,
        decision: 'allow',
        workspace_id: owner.workspace.id,
        agent: { mode: 'new', name: started.view.agent.suggested_name },
      },
      { binding: started.binding },
    );
    expect(decided.status).toBe(200);
    expect(decided.res.headers.get('referrer-policy')).toBe('no-referrer');
    const back = new URL(decided.data.redirect_to);
    expect(`${back.origin}${back.pathname}`).toBe(CLAUDE_REDIRECT);
    expect(back.searchParams.get('state')).toBe('state-123');
    expect(back.searchParams.get('iss')).toBe(ISSUER);
    const code = back.searchParams.get('code')!;

    // 7. Code exchange (form-urlencoded, public client) creates the agent.
    const exchanged = await token({
      grant_type: 'authorization_code',
      code,
      code_verifier: started.verifier,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: CLAUDE_CLIENT_ID,
      resource: RESOURCE,
    });
    expect(exchanged.status).toBe(200);
    expect(exchanged.res.headers.get('cache-control')).toBe('no-store');
    expect(exchanged.data.token_type).toBe('Bearer');
    expect(exchanged.data.scope).toBe('agent');
    const access = exchanged.data.access_token as string;
    const refresh = exchanged.data.refresh_token as string;
    expect(access.startsWith('rsoa_')).toBe(true);
    const [created] = await getDb()
      .select()
      .from(agents)
      .where(and(eq(agents.workspaceId, owner.workspace.id), eq(agents.name, 'claude')));
    expect(created).toBeDefined();

    // 8. Tools as the new agent.
    const who = await mcpTool(access, 'whoami');
    expect(who.isError).toBe(false);
    expect(who.payload).toMatchObject({ name: 'claude' });
    expect(who.payload.delivery.mode).toBe('none');
    const listed = await mcpTool(access, 'list_agents');
    expect(listed.payload.agents.find((a: { name: string }) => a.name === 'claude')).toMatchObject({ you: true });
    const sent = await mcpTool(access, 'create_task', { to: 'helper', title: 'Summarize', description: 'Summarize the notes.', result_schema: RESULT_SCHEMA });
    expect(sent.isError, JSON.stringify(sent.payload)).toBe(false);
    const received = await mcpTool(otherKey, 'create_task', { to: 'claude', title: 'Reply', description: 'Please reply.', result_schema: RESULT_SCHEMA });
    expect(received.isError).toBe(false);
    const before = await workspaceSnapshot(owner.workspace.id);
    for (const [tool, args] of [
      ['set_agent_sharing', { agent: 'helper', shared: true }],
      ['invite_guest', { agent: 'helper', guest_handle: 'someone', offers: ['x'] }],
      ['complete_task', { id: received.payload.task.id, result: { ok: true } }],
      ['send_message', { to: 'helper', body: 'hi', task_id: received.payload.task.id }],
    ] as const) {
      const denied = await mcpTool(access, tool, args);
      expect(denied.isError, tool).toBe(true);
      expect(denied.payload.error, tool).toBe('insufficient_scope');
    }
    expect(await workspaceSnapshot(owner.workspace.id)).toBe(before);

    // 9. Refresh rotates; the old access token keeps working until it expires. Reuse after the window revokes.
    const rotated = await token({ grant_type: 'refresh_token', refresh_token: refresh, client_id: CLAUDE_CLIENT_ID });
    expect(rotated.status).toBe(200);
    expect(rotated.data.refresh_token).not.toBe(refresh);
    expect((await mcpTool(access, 'whoami')).isError).toBe(false);
    now += 3_000;
    const reused = await token({ grant_type: 'refresh_token', refresh_token: refresh, client_id: CLAUDE_CLIENT_ID });
    expect(reused.status).toBe(400);
    expect(reused.data.error).toBe('invalid_grant');
    expect((await mcpTool(rotated.data.access_token, 'whoami')).httpStatus).toBe(401);

    // 10. A fresh grant: listed, then Disconnect → 401. revokeAgent on another grant's agent → 401.
    const fresh = await connect(owner, { mode: 'new', name: 'claude-two' }, CLAUDE);
    const list = await call(listConnectedRoute, `${ISSUER}/api/v1/connected-apps`, { cookie: owner.cookie });
    expect(list.status).toBe(200);
    expect(list.res.headers.get('cache-control')).toBe('private, no-store');
    const row = list.data.connected_apps.find((app: { agent: { name: string } }) => app.agent.name === 'claude-two');
    expect(row).toMatchObject({ status: 'active', redirect_host: 'claude.ai', revoked_at: null, scope: 'agent' });
    expect(row.client).toMatchObject({ client_name: 'Claude', verified: true, kind: 'cimd' });
    expect(row.approved_by_email).toBe(owner.email);
    const ended = list.data.connected_apps.find((app: { agent: { name: string } }) => app.agent.name === 'claude');
    expect(ended.status).toBe('revoked');
    expect(typeof ended.revoked_at).toBe('string');
    const disconnected = await call(disconnectRoute, `${ISSUER}/api/v1/connected-apps/${row.id}/revoke`, {
      method: 'POST',
      cookie: owner.cookie,
      params: { id: row.id },
    });
    expect(disconnected.status).toBe(200);
    expect(disconnected.data.connected_app).toMatchObject({ id: row.id, status: 'revoked' });
    expect(disconnected.data.connected_app.agent.revoked).toBe(false);
    expect((await mcpTool(fresh.tokens.access_token, 'whoami')).httpStatus).toBe(401);
    const again = await call(disconnectRoute, `${ISSUER}/api/v1/connected-apps/${row.id}/revoke`, {
      method: 'POST',
      cookie: owner.cookie,
      params: { id: row.id },
    });
    expect(again.status).toBe(200);

    const third = await connect(owner, { mode: 'new', name: 'claude-three' }, CLAUDE);
    await revokeAgent(owner.workspace.id, await agentId(owner.workspace.id, 'claude-three'));
    expect((await mcpTool(third.tokens.access_token, 'whoami')).httpStatus).toBe(401);
    const [grant] = await getDb()
      .select()
      .from(oauthGrants)
      .where(eq(oauthGrants.agentId, await agentId(owner.workspace.id, 'claude-three')));
    expect(grant?.revokedReason).toBe('agent_revoked');
  });

  it('Deny returns access_denied with state and iss, and creates no agent', async () => {
    const owner = await signIn();
    const started = await startConnect(owner, CLAUDE);
    const denied = await postConsent(
      owner,
      { request_id: started.view.request_id, csrf_token: started.view.csrf_token, decision: 'deny' },
      { binding: started.binding },
    );
    expect(denied.status).toBe(200);
    const back = new URL(denied.data.redirect_to);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('state-123');
    expect(back.searchParams.get('iss')).toBe(ISSUER);
    expect(back.searchParams.get('code')).toBeNull();
    const rows = await getDb().select().from(agents).where(eq(agents.workspaceId, owner.workspace.id));
    expect(rows).toEqual([]);
  });
});

async function agentId(workspaceId: string, name: string): Promise<string> {
  const [row] = await getDb()
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.name, name)));
  return row!.id;
}

describe('MCP OAuth end to end (fake generic client via DCR)', () => {
  it('registers with RFC 7591, then authorizes, consents, exchanges and calls whoami', async () => {
    vi.stubEnv('MCP_OAUTH_DCR', '1');
    const redirectUri = 'https://app.example.com/oauth/callback';

    // 1–2. Discovery: the AS now advertises a registration endpoint; every client is public.
    const unauth = await mcpPost(null, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(unauth.status).toBe(401);
    const as = await call(asMetadataRoute, `${ISSUER}/.well-known/oauth-authorization-server`);
    expect(as.data.registration_endpoint).toBe(`${ISSUER}/api/oauth/register`);
    expect(as.data.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(as.data.client_id_metadata_document_supported).toBe(true);

    // 3. DCR: the client asks for a secret (as many SDKs do); it is registered as a public client instead.
    const reg = await register({
      client_name: 'Acme MCP',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'agent agent:owner',
    });
    expect(reg.status).toBe(201);
    expect(reg.res.headers.get('cache-control')).toBe('no-store');
    expect(reg.res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(reg.data).toMatchObject({ token_endpoint_auth_method: 'none', scope: 'agent', redirect_uris: [redirectUri] });
    expect(reg.data!.client_secret).toBeUndefined();
    const clientId = reg.data!.client_id as string;
    expect(clientId).toMatch(/^rsdc_/);

    // 4–5. Authorize + consent: labelled unverified with the redirect host.
    const owner = await signIn();
    const started = await startConnect(owner, { client_id: clientId, redirect_uri: redirectUri });
    expect(started.view.client).toMatchObject({ kind: 'dcr', verified: false, display_name: 'Acme MCP' });
    expect(started.view.redirect).toEqual({ host: 'app.example.com', loopback: false, kind: 'https', scheme: null });
    const decided = await postConsent(
      owner,
      {
        request_id: started.view.request_id,
        csrf_token: started.view.csrf_token,
        decision: 'allow',
        workspace_id: started.view.workspaces[0]!.id,
        agent: { mode: 'new', name: 'acme' },
      },
      { binding: started.binding },
    );
    expect(decided.status).toBe(200);
    const back = new URL(decided.data.redirect_to);
    expect(`${back.origin}${back.pathname}`).toBe(redirectUri);
    expect(back.searchParams.get('iss')).toBe(ISSUER);

    // 6. Token exchange as a public client (no secret), then whoami over MCP.
    const exchange = await token({
      grant_type: 'authorization_code',
      code: back.searchParams.get('code')!,
      code_verifier: started.verifier,
      redirect_uri: redirectUri,
      client_id: clientId,
      resource: RESOURCE,
    });
    expect(exchange.status).toBe(200);
    expect(exchange.data.scope).toBe('agent');
    const who = await mcpTool(exchange.data.access_token, 'whoami');
    expect(who.isError).toBe(false);
    expect(who.payload.name).toBe('acme');

    // 7. Refresh rotates; the narrow scope still refuses owner tools.
    const refreshed = await token({ grant_type: 'refresh_token', refresh_token: exchange.data.refresh_token, client_id: clientId });
    expect(refreshed.status).toBe(200);
    expect(refreshed.data.refresh_token).not.toBe(exchange.data.refresh_token);
    const owned = await mcpTool(refreshed.data.access_token, 'set_workspace_handle', { handle: 'takeover' });
    expect(owned.payload).toMatchObject({ error: 'insufficient_scope' });
  });
});
