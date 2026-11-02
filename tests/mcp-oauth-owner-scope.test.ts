import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as asMetadataRoute } from '@/app/.well-known/oauth-authorization-server/route';
import { GET as listConnectedRoute } from '@/app/api/v1/connected-apps/route';
import { getDb } from '@/db';
import { agents, oauthClients, oauthGrants } from '@/db/schema';
import { setCimdFetcherForTests } from '@/lib/oauth/cimd';
import { disableClient } from '@/lib/oauth/clients';
import { mcpAuthHandler } from '@/lib/mcp-server';
import { RSK_SCOPES } from '@/lib/oauth/config';
import { ELEVATED_SCOPE_COPY, UNVERIFIED_ELEVATED_WARNING, grantedScope } from '@/lib/oauth/consent';
import { protectedResourceMetadata } from '@/lib/oauth/metadata';
import { TOOL_SCOPES, toolAllowed } from '@/lib/oauth/scopes';
import { setOAuthClockForTests } from '@/lib/oauth/tokens';
import { call, createAgent, createKey, mcpListTools, mcpTool, signIn } from './helpers';
import { CHATGPT_CLIENT_ID, stubCimd } from './oauth-fixtures';
import { ISSUER, connect, postConsent, register, startConnect, token, type Owner } from './oauth-flow';

/** §5.10: the higher OAuth scopes (agent:respond, agent:owner) behind MCP_OAUTH_OWNER_SCOPE and a consent opt-in. */

const ALL = 'agent agent:respond agent:owner';
const DAY = 24 * 60 * 60 * 1000;
const AGENT_TOOLS = Object.keys(TOOL_SCOPES).filter((name) => toolAllowed(name, ['agent'])).sort();
const RESPOND_TOOLS = ['ask', 'complete_task', 'fail_task'];
const OWNER_TOOLS = Object.entries(TOOL_SCOPES)
  .filter(([, scope]) => scope === 'agent:owner')
  .map(([name]) => name)
  .sort();
const WEB = 'https://app.example.com/oauth/callback';
let now = Date.now();

beforeEach(async () => {
  await getDb().delete(oauthClients);
  now = Date.now();
  setOAuthClockForTests(() => now);
  vi.stubEnv('MCP_OAUTH_ENABLED', '1');
  vi.stubEnv('MCP_OAUTH_ISSUER', ISSUER);
  vi.stubEnv('MCP_OAUTH_OWNER_SCOPE', '1');
  vi.stubEnv('VALETTO_AGENT_GUESTS', '1');
  stubCimd();
});

afterEach(() => {
  setOAuthClockForTests(null);
  setCimdFetcherForTests(null);
  vi.unstubAllEnvs();
});

const names = async (bearer: string) => (await mcpListTools(bearer)).map((tool) => tool.name).sort();

async function grantRow(accessToken: string) {
  const agentId = (await mcpTool(accessToken, 'whoami')).payload.id as string;
  const [grant] = await getDb().select().from(oauthGrants).where(eq(oauthGrants.agentId, agentId));
  return grant!;
}

function connectWith(owner: Owner, scope: string, optIn?: boolean, name = 'chatgpt') {
  return connect(owner, { mode: 'new', name }, { scope }, optIn === undefined ? {} : { grant_owner: optIn });
}

describe('metadata', () => {
  it('advertises the higher scopes while the flag is on, and only agent while it is off', async () => {
    const as = await call(asMetadataRoute, `${ISSUER}/.well-known/oauth-authorization-server`);
    expect(as.data.scopes_supported).toEqual(['agent', 'agent:respond', 'agent:owner']);
    expect(protectedResourceMetadata().scopes_supported).toEqual(['agent', 'agent:respond', 'agent:owner']);
    vi.stubEnv('MCP_OAUTH_OWNER_SCOPE', '');
    const off = await call(asMetadataRoute, `${ISSUER}/.well-known/oauth-authorization-server`);
    expect(off.data.scopes_supported).toEqual(['agent']);
    expect(protectedResourceMetadata().scopes_supported).toEqual(['agent']);
  });
});

describe('401 challenge', () => {
  it('still says scope="agent" while the flag is on', async () => {
    const res = await mcpAuthHandler(
      new Request(`${ISSUER}/api/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
    );
    expect(res.status).toBe(401);
    const header = res.headers.get('www-authenticate') ?? '';
    expect(header).toContain('scope="agent"');
    expect(header).not.toContain('agent:');
  });
});

describe('consent view', () => {
  it('always offers both higher scopes while the flag is on, marking which ones the app asked for', async () => {
    const owner = await signIn();
    const offered = (asked: string[]) => [
      { name: 'agent:respond', ...ELEVATED_SCOPE_COPY['agent:respond'], requested_by_client: asked.includes('agent:respond') },
      { name: 'agent:owner', ...ELEVATED_SCOPE_COPY['agent:owner'], requested_by_client: asked.includes('agent:owner') },
    ];
    const plain = await startConnect(owner, { scope: 'agent' });
    expect(plain.view.client.verified).toBe(true);
    expect(plain.view.extra_scopes).toEqual({
      offered: offered([]),
      opt_in_field: 'grant_owner',
      unverified_client: false,
      warning: null,
      connection_days: 30,
    });
    const none = await startConnect(owner, { scope: null });
    expect(none.view.extra_scopes.offered).toEqual(offered([]));
    const asked = await startConnect(owner, { scope: `${ALL} offline_access` });
    expect(asked.view.extra_scopes.offered).toEqual(offered(['agent:respond', 'agent:owner']));
    const one = await startConnect(owner, { scope: 'agent:owner' });
    expect(one.view.extra_scopes.offered).toEqual(offered(['agent:owner']));
  });

  it('flags an unverified (DCR) app, whatever it asked for', async () => {
    vi.stubEnv('MCP_OAUTH_DCR', '1');
    const res = await register({ client_name: 'Acme MCP', redirect_uris: [WEB] });
    expect(res.status).toBe(201);
    const clientId = res.data!.client_id as string;
    const owner = await signIn();
    const asked = await startConnect(owner, { client_id: clientId, redirect_uri: WEB, scope: ALL });
    expect(asked.view.client.verified).toBe(false);
    expect(asked.view.extra_scopes).toMatchObject({ unverified_client: true, warning: UNVERIFIED_ELEVATED_WARNING });
    // Also when the app asked for nothing extra: the offer is always there, so the warning is too.
    const plain = await startConnect(owner, { client_id: clientId, redirect_uri: WEB, scope: 'agent' });
    expect(plain.view.extra_scopes).toMatchObject({ unverified_client: true, warning: UNVERIFIED_ELEVATED_WARNING });
    expect(plain.view.extra_scopes.offered.every((s) => !s.requested_by_client)).toBe(true);
  });
});

describe('consent POST', () => {
  it('grants the higher scopes only with grant_owner: true, whether or not the app asked, and lists tools per scope', async () => {
    const owner = await signIn();
    const without = await connectWith(owner, ALL, undefined, 'plain');
    expect(without.tokens.scope).toBe('agent');
    expect(await names(without.tokens.access_token)).toEqual(AGENT_TOOLS);

    const declined = await connectWith(owner, ALL, false, 'declined');
    expect(declined.tokens.scope).toBe('agent');

    const full = await connectWith(owner, ALL, true, 'full');
    expect(full.tokens.scope).toBe(ALL);
    expect(await names(full.tokens.access_token)).toEqual(Object.keys(TOOL_SCOPES).sort());

    // The common case: the app follows the 401 challenge (agent) or asks for nothing. The opt-in still grants all,
    // and the token response's scope says what was granted (RFC 6749 §3.3).
    for (const [scope, name] of [['agent', 'claude'], [null, 'cursor'], ['agent:respond', 'partial']] as const) {
      const app = await connectWith(owner, scope as string, true, name);
      expect(app.tokens.scope).toBe(ALL);
      expect((await grantRow(app.tokens.access_token)).scope).toBe(ALL);
      expect(await names(app.tokens.access_token)).toEqual(Object.keys(TOOL_SCOPES).sort());
    }
  });

  it('lists tools per scope for a grant holding only one higher scope', async () => {
    const owner = await signIn();
    for (const [extra, tools] of [['agent:respond', RESPOND_TOOLS], ['agent:owner', OWNER_TOOLS]] as const) {
      const app = await connectWith(owner, 'agent', false, extra.replace(':', '-'));
      await getDb().update(oauthGrants).set({ scope: `agent ${extra}` }).where(eq(oauthGrants.id, (await grantRow(app.tokens.access_token)).id));
      expect(await names(app.tokens.access_token)).toEqual([...AGENT_TOOLS, ...tools].sort());
    }
  });

  it('an opted-in token can call the higher tools; an agent-only one still gets insufficient_scope', async () => {
    const owner = await signIn();
    const full = await connectWith(owner, ALL, true, 'full');
    const plain = await connectWith(owner, ALL, false, 'plain');
    const handle = `own${Math.random().toString(36).slice(2, 10)}`;
    const refused = await mcpTool(plain.tokens.access_token, 'set_workspace_handle', { handle });
    expect(refused.isError).toBe(true);
    expect(refused.payload.error).toBe('insufficient_scope');
    const done = await mcpTool(full.tokens.access_token, 'set_workspace_handle', { handle });
    expect(done.isError, done.text).toBeFalsy();

    // agent:respond: finish a task another agent sent to the connected app.
    const bee = await createAgent(owner.cookie, 'bee');
    const beeKey = await createKey(owner.cookie, bee.id);
    const created = await mcpTool(beeKey, 'create_task', {
      to: 'full',
      title: 'Work',
      description: 'Do the work.',
      result_schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    });
    expect(created.isError, created.text).toBeFalsy();
    const finished = await mcpTool(full.tokens.access_token, 'complete_task', { id: created.payload.task.id, result: { ok: true } });
    expect(finished.isError, JSON.stringify(finished.payload)).toBeFalsy();
  });

  it('an opted-in connection lasts MCP_OAUTH_OWNER_MAX_DAYS (default 30), an agent-only one 365 days', async () => {
    const owner = await signIn();
    const plain = await connectWith(owner, ALL, false, 'plain');
    expect((await grantRow(plain.tokens.access_token)).absoluteExpiresAt.getTime()).toBe(now + 365 * DAY);
    const full = await connectWith(owner, ALL, true, 'full');
    expect((await grantRow(full.tokens.access_token)).absoluteExpiresAt.getTime()).toBe(now + 30 * DAY);
    vi.stubEnv('MCP_OAUTH_OWNER_MAX_DAYS', '7');
    const short = await connectWith(owner, ALL, true, 'short');
    expect((await grantRow(short.tokens.access_token)).absoluteExpiresAt.getTime()).toBe(now + 7 * DAY);
    vi.stubEnv('MCP_OAUTH_OWNER_MAX_DAYS', 'nonsense');
    const fallback = await connectWith(owner, ALL, true, 'fallback');
    expect((await grantRow(fallback.tokens.access_token)).absoluteExpiresAt.getTime()).toBe(now + 30 * DAY);

    // Refresh tokens stop with the connection.
    now += 30 * DAY;
    const late = await token({ grant_type: 'refresh_token', refresh_token: full.tokens.refresh_token!, client_id: CHATGPT_CLIENT_ID });
    expect(late.status).toBe(400);
    expect(late.data.error).toBe('invalid_grant');
  });

  it('a disabled client never gets the higher scope', async () => {
    expect(grantedScope(true, { disabledAt: new Date() })).toBe('agent');
    expect(grantedScope(true, { disabledAt: null })).toBe(ALL);
    expect(grantedScope(false, { disabledAt: null })).toBe('agent');

    const owner = await signIn();
    const started = await startConnect(owner, { scope: ALL });
    const [client] = await getDb().select().from(oauthClients).where(eq(oauthClients.clientId, CHATGPT_CLIENT_ID));
    await disableClient(client!.id);
    const res = await postConsent(
      owner,
      {
        request_id: started.view.request_id,
        csrf_token: started.view.csrf_token,
        decision: 'allow',
        workspace_id: started.view.workspaces[0]!.id,
        agent: { mode: 'new', name: 'chatgpt' },
        grant_owner: true,
      },
      { binding: started.binding },
    );
    expect(res.status).toBe(404);
    expect(await getDb().select().from(oauthGrants)).toHaveLength(0);
  });
});

describe('refresh', () => {
  it('never widens scope', async () => {
    const owner = await signIn();
    const plain = await connectWith(owner, ALL, false);
    const widen = await token({
      grant_type: 'refresh_token',
      refresh_token: plain.tokens.refresh_token!,
      client_id: CHATGPT_CLIENT_ID,
      scope: ALL,
    });
    expect(widen.status).toBe(400);
    expect(widen.data.error).toBe('invalid_scope');
    const same = await token({ grant_type: 'refresh_token', refresh_token: plain.tokens.refresh_token!, client_id: CHATGPT_CLIENT_ID });
    expect(same.status).toBe(200);
    expect(same.data.scope).toBe('agent');
    expect(await names(same.data.access_token)).toEqual(AGENT_TOOLS);
  });

  it('a one-higher-scope grant refreshes to the same scope, not more', async () => {
    const owner = await signIn();
    const respond = await connectWith(owner, 'agent', false);
    await getDb().update(oauthGrants).set({ scope: 'agent agent:respond' }).where(eq(oauthGrants.id, (await grantRow(respond.tokens.access_token)).id));
    const asked = await token({
      grant_type: 'refresh_token',
      refresh_token: respond.tokens.refresh_token!,
      client_id: CHATGPT_CLIENT_ID,
      scope: ALL,
    });
    expect(asked.data.error).toBe('invalid_scope');
    const same = await token({ grant_type: 'refresh_token', refresh_token: respond.tokens.refresh_token!, client_id: CHATGPT_CLIENT_ID });
    expect(same.data.scope).toBe('agent agent:respond');
    expect(await names(same.data.access_token)).toEqual([...AGENT_TOOLS, ...RESPOND_TOOLS].sort());
  });
});

describe('MCP_OAUTH_OWNER_SCOPE off', () => {
  it('offers nothing extra, and asks for a higher scope fall back to agent without failing, even with the opt-in', async () => {
    vi.stubEnv('MCP_OAUTH_OWNER_SCOPE', '');
    const owner = await signIn();
    const started = await startConnect(owner, { scope: ALL });
    expect(started.view.extra_scopes).toMatchObject({ offered: [], unverified_client: false, warning: null, connection_days: null });
    const app = await connectWith(owner, ALL, true);
    expect(app.tokens.scope).toBe('agent');
    const grant = await grantRow(app.tokens.access_token);
    expect(grant.scope).toBe('agent');
    expect(grant.absoluteExpiresAt.getTime()).toBe(now + 365 * DAY);
    expect(await names(app.tokens.access_token)).toEqual(AGENT_TOOLS);
  });

  it('turning it off after consent grants nothing extra at the code exchange', async () => {
    const owner = await signIn();
    const started = await startConnect(owner, { scope: ALL });
    const decided = await postConsent(
      owner,
      {
        request_id: started.view.request_id,
        csrf_token: started.view.csrf_token,
        decision: 'allow',
        workspace_id: started.view.workspaces[0]!.id,
        agent: { mode: 'new', name: 'chatgpt' },
        grant_owner: true,
      },
      { binding: started.binding },
    );
    expect(decided.status).toBe(200);
    vi.stubEnv('MCP_OAUTH_OWNER_SCOPE', '');
    const exchanged = await token({
      grant_type: 'authorization_code',
      code: new URL(decided.data.redirect_to).searchParams.get('code')!,
      code_verifier: started.verifier,
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      client_id: CHATGPT_CLIENT_ID,
      resource: `${ISSUER}/api/mcp`,
    });
    expect(exchanged.status).toBe(200);
    expect(exchanged.data.scope).toBe('agent');
  });

  it('an existing opted-in grant drops to agent tools while the flag is off', async () => {
    const owner = await signIn();
    const full = await connectWith(owner, ALL, true);
    expect(await names(full.tokens.access_token)).toHaveLength(19);
    vi.stubEnv('MCP_OAUTH_OWNER_SCOPE', '');
    expect(await names(full.tokens.access_token)).toEqual(AGENT_TOOLS);
    const refused = await mcpTool(full.tokens.access_token, 'set_workspace_handle', { handle: 'acme-owner' });
    expect(refused.payload.error).toBe('insufficient_scope');
    const refreshed = await token({ grant_type: 'refresh_token', refresh_token: full.tokens.refresh_token!, client_id: CHATGPT_CLIENT_ID });
    expect(refreshed.data.scope).toBe('agent');
  });
});

describe('rsk_ keys', () => {
  it('list all 19 tools with the flag on or off', async () => {
    const owner = await signIn();
    const bee = await createAgent(owner.cookie, 'bee');
    const key = await createKey(owner.cookie, bee.id);
    expect(await names(key)).toEqual(Object.keys(TOOL_SCOPES).sort());
    expect(Object.keys(TOOL_SCOPES).every((name) => toolAllowed(name, RSK_SCOPES))).toBe(true);
    vi.stubEnv('MCP_OAUTH_OWNER_SCOPE', '');
    expect(await names(key)).toEqual(Object.keys(TOOL_SCOPES).sort());
  });
});

describe('connected apps API', () => {
  it('exposes the granted scopes and whether the connection is elevated', async () => {
    const owner = await signIn();
    await connectWith(owner, ALL, false, 'plain');
    await connectWith(owner, ALL, true, 'full');
    const list = await call(listConnectedRoute, `${ISSUER}/api/v1/connected-apps`, { cookie: owner.cookie });
    expect(list.status).toBe(200);
    const byAgent = Object.fromEntries(
      (list.data.connected_apps as Array<{ agent: { name: string }; scopes: string[]; elevated: boolean; scope: string }>).map(
        (app) => [app.agent.name, app],
      ),
    );
    expect(byAgent.plain).toMatchObject({ scope: 'agent', scopes: ['agent'], elevated: false });
    expect(byAgent.full).toMatchObject({ scope: ALL, scopes: ['agent', 'agent:respond', 'agent:owner'], elevated: true });
    const [fullAgent] = await getDb().select().from(agents).where(eq(agents.name, 'full'));
    expect(fullAgent!.description).toBe('Connected app: ChatGPT (OAuth). Can work on tasks sent to it.');
  });
});
