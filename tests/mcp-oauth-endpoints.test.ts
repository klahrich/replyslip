import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as asMetadataRoute } from '@/app/.well-known/oauth-authorization-server/route';
import { GET as prmRoute } from '@/app/.well-known/oauth-protected-resource/[[...path]]/route';
import { GET as authorizeRoute } from '@/app/api/oauth/authorize/route';
import { POST as consentRoute } from '@/app/api/oauth/consent/route';
import { OPTIONS as tokenOptions, POST as tokenRoute } from '@/app/api/oauth/token/route';
import { PATCH as renameRoute } from '@/app/api/v1/agents/[id]/route';
import { GET as listConnectedRoute } from '@/app/api/v1/connected-apps/route';
import { POST as disconnectRoute } from '@/app/api/v1/connected-apps/[id]/revoke/route';
import { getDb } from '@/db';
import { agents, oauthAuthorizationRequests, oauthClients } from '@/db/schema';
import { setCimdFetcherForTests } from '@/lib/oauth/cimd';
import { loadConsentRequest } from '@/lib/oauth/consent';
import { setOAuthClockForTests } from '@/lib/oauth/tokens';
import { call, createAgent, createKey, mcpTool, signIn } from './helpers';
import { CLAUDE_CLIENT_ID, pkcePair, stubCimd } from './oauth-fixtures';
import {
  CHATGPT_REDIRECT,
  CLAUDE_REDIRECT,
  ISSUER,
  authorizeQuery,
  authorizeRequest,
  connect,
  postConsent,
  revoke,
  sessionOf,
  startConnect,
  token,
} from './oauth-flow';

const CLAUDE = { client_id: CLAUDE_CLIENT_ID, redirect_uri: CLAUDE_REDIRECT };

beforeEach(async () => {
  await getDb().delete(oauthClients);
  setOAuthClockForTests(null);
  vi.stubEnv('MCP_OAUTH_ENABLED', '1');
  vi.stubEnv('MCP_OAUTH_ISSUER', ISSUER);
  stubCimd();
});

afterEach(() => {
  setCimdFetcherForTests(null);
  vi.unstubAllEnvs();
});

function allowBody(view: Awaited<ReturnType<typeof startConnect>>['view'], agent: Record<string, unknown>) {
  return {
    request_id: view.request_id,
    csrf_token: view.csrf_token,
    decision: 'allow',
    workspace_id: view.workspaces[0]!.id,
    agent,
  };
}

describe('GET /api/oauth/authorize', () => {
  it('shows an error page, never a redirect, for an unknown client or redirect_uri', async () => {
    const unknown = await authorizeRequest(authorizeQuery({ client_id: 'https://evil.example/client.json' }));
    expect(unknown.status).toBe(400);
    expect(unknown.location).toBeNull();
    expect(unknown.res.headers.get('content-type')).toContain('text/html');
    expect(unknown.text).toContain('noindex');
    expect(unknown.res.headers.get('x-frame-options')).toBe('DENY');
    const badRedirect = await authorizeRequest(authorizeQuery({ redirect_uri: 'https://chatgpt.com/elsewhere' }));
    expect(badRedirect.status).toBe(400);
    expect(badRedirect.location).toBeNull();
    const missingClient = await authorizeRequest(authorizeQuery({ client_id: null }));
    expect(missingClient.status).toBe(400);
  });

  it('redirects protocol errors back to the client with state and iss', async () => {
    const plain = await authorizeRequest(authorizeQuery({ code_challenge_method: 'plain' }));
    expect(plain.status).toBe(302);
    expect(`${plain.location!.origin}${plain.location!.pathname}`).toBe(CHATGPT_REDIRECT);
    expect(plain.location!.searchParams.get('error')).toBe('invalid_request');
    expect(plain.location!.searchParams.get('state')).toBe('state-123');
    expect(plain.location!.searchParams.get('iss')).toBe(ISSUER);
    const target = await authorizeRequest(authorizeQuery({ resource: 'https://valetto.tech/other' }));
    expect(target.location!.searchParams.get('error')).toBe('invalid_target');
    const scope = await authorizeRequest(authorizeQuery({ scope: 'agent:owner' }));
    // Unknown or privileged scopes are dropped, not refused (§2.5): the request goes on to consent with `agent`.
    expect(scope.location!.pathname).toBe('/oauth/consent');
    const type = await authorizeRequest(authorizeQuery({ response_type: 'token' }));
    expect(type.location!.searchParams.get('error')).toBe('unsupported_response_type');
  });

  it('302s (not 307) to the consent page with the binding cookie and private headers', async () => {
    const ok = await authorizeRequest(authorizeQuery());
    expect(ok.status).toBe(302);
    expect(ok.location!.origin).toBe(ISSUER);
    expect(ok.location!.pathname).toBe('/oauth/consent');
    expect(ok.location!.searchParams.get('req')).toBeTruthy();
    const setCookie = ok.res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^__Host-valetto_oauth=/);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(ok.res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(ok.res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(ok.res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('POST /api/oauth/token and /revoke', () => {
  it('takes form-urlencoded only and names bad grant types', async () => {
    const asJson = await call(tokenRoute, `${ISSUER}/api/oauth/token`, { body: { grant_type: 'authorization_code' } });
    expect(asJson.status).toBe(400);
    expect(asJson.data.error).toBe('invalid_request');
    const missing = await token({ client_id: CLAUDE_CLIENT_ID });
    expect(missing.data.error).toBe('invalid_request');
    const password = await token({ grant_type: 'password', client_id: CLAUDE_CLIENT_ID });
    expect(password.data.error).toBe('unsupported_grant_type');
    expect(password.res.headers.get('access-control-allow-origin')).toBe('*');
    expect(password.res.headers.get('referrer-policy')).toBe('no-referrer');
    const unknownClient = await token({ grant_type: 'authorization_code', client_id: 'https://evil.example/c.json' });
    expect(unknownClient.status).toBe(401);
    expect(unknownClient.data.error).toBe('invalid_client');
    const preflight = await tokenOptions();
    expect(preflight.status).toBe(204);
  });

  it('rejects a wrong PKCE verifier', async () => {
    const owner = await signIn();
    const started = await startConnect(owner, CLAUDE);
    const decided = await postConsent(owner, allowBody(started.view, { mode: 'new', name: 'claude' }), {
      binding: started.binding,
    });
    const code = new URL(decided.data.redirect_to).searchParams.get('code')!;
    const form = { grant_type: 'authorization_code', code, redirect_uri: CLAUDE_REDIRECT, client_id: CLAUDE_CLIENT_ID };
    const wrong = await token({ ...form, code_verifier: pkcePair().verifier });
    expect(wrong.data.error).toBe('invalid_grant');
  });

  it('revokes an access token; unknown tokens still answer 200', async () => {
    const owner = await signIn();
    const connected = await connect(owner, { mode: 'new', name: 'claude' }, CLAUDE);
    expect((await mcpTool(connected.tokens.access_token, 'whoami')).isError).toBe(false);
    const done = await revoke({ token: connected.tokens.access_token, client_id: CLAUDE_CLIENT_ID });
    expect(done.status).toBe(200);
    expect((await mcpTool(connected.tokens.access_token, 'whoami')).httpStatus).toBe(401);
    expect((await revoke({ token: 'rsoa_not_a_token', client_id: CLAUDE_CLIENT_ID })).status).toBe(200);
    const refreshGone = await revoke({ token: connected.tokens.refresh_token!, client_id: CLAUDE_CLIENT_ID });
    expect(refreshGone.status).toBe(200);
    const after = await token({ grant_type: 'refresh_token', refresh_token: connected.tokens.refresh_token!, client_id: CLAUDE_CLIENT_ID });
    expect(after.data.error).toBe('invalid_grant');
  });
});

describe('consent', () => {
  it('refuses a missing binding cookie, a foreign Origin, a bad CSRF token, a second user and a second POST', async () => {
    const owner = await signIn();
    const started = await startConnect(owner, CLAUDE);
    const body = allowBody(started.view, { mode: 'new', name: 'claude' });

    const noCookie = await postConsent(owner, body);
    expect(noCookie.status).toBe(403);
    expect(noCookie.data.error.code).toBe('binding_failed');
    const foreign = await postConsent(owner, body, { binding: started.binding, origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(foreign.data.error.code).toBe('bad_origin');
    const csrf = await postConsent(owner, { ...body, csrf_token: 'a'.repeat(64) }, { binding: started.binding });
    expect(csrf.status).toBe(403);
    expect(csrf.data.error.code).toBe('csrf_failed');

    const intruder = await signIn();
    await expect(loadConsentRequest(started.reqToken, await sessionOf(intruder))).rejects.toMatchObject({
      status: 404,
      code: 'request_not_found',
    });
    const intruderView = { ...body, workspace_id: intruder.workspace.id };
    const second = await postConsent(intruder, intruderView, { binding: started.binding });
    expect([403, 404]).toContain(second.status);

    const first = await postConsent(owner, body, { binding: started.binding });
    expect(first.status).toBe(200);
    const replay = await postConsent(owner, body, { binding: started.binding });
    expect(replay.status).toBe(409);
    expect(replay.data.error.code).toBe('request_completed');
    expect(replay.res.headers.get('referrer-policy')).toBe('no-referrer');
    await expect(loadConsentRequest(started.reqToken, await sessionOf(owner))).rejects.toMatchObject({ status: 409 });
  });

  it('answers 404 for another user even with a valid CSRF shape', async () => {
    const owner = await signIn();
    const started = await startConnect(owner, CLAUDE);
    const intruder = await signIn();
    const res = await postConsent(
      intruder,
      { ...allowBody(started.view, { mode: 'new', name: 'claude' }), workspace_id: intruder.workspace.id },
      { binding: started.binding },
    );
    // The CSRF token is bound to the owner, so the intruder fails there before the request is even looked up.
    expect(res.status).toBe(403);
    expect(res.data.error.code).toBe('csrf_failed');
  });

  it('name_taken carries details.suggested_name; bad names are invalid_name', async () => {
    const owner = await signIn();
    await createAgent(owner.cookie, 'claude');
    const started = await startConnect(owner, CLAUDE);
    expect(started.view.agent.suggested_name).toBe('claude-2');
    const taken = await postConsent(owner, allowBody(started.view, { mode: 'new', name: 'claude' }), {
      binding: started.binding,
    });
    expect(taken.status).toBe(409);
    expect(taken.data.error.code).toBe('name_taken');
    expect(taken.data.error.details.suggested_name).toBe('claude-2');
    const bad = await postConsent(owner, allowBody(started.view, { mode: 'new', name: '9 bad' }), {
      binding: started.binding,
    });
    expect(bad.status).toBe(400);
    expect(bad.data.error.code).toBe('invalid_name');
  });

  it('offers Reconnect only for agents the same client app connected', async () => {
    const owner = await signIn();
    const chatgpt = await connect(owner, { mode: 'new', name: 'chatgpt' });
    const bot = await createAgent(owner.cookie, 'local-bot');
    const claudeStart = await startConnect(owner, CLAUDE);
    expect(claudeStart.view.agent.reconnect_options).toEqual([]);
    const chatgptAgent = (await getDb().select().from(agents).where(and(eq(agents.workspaceId, owner.workspace.id), eq(agents.name, 'chatgpt'))))[0]!;
    const crossApp = await postConsent(owner, allowBody(claudeStart.view, { mode: 'reconnect', agent_id: chatgptAgent.id }), {
      binding: claudeStart.binding,
    });
    expect(crossApp.status).toBe(400);
    expect(crossApp.data.error.code).toBe('validation_error');
    const rskBot = await postConsent(owner, allowBody(claudeStart.view, { mode: 'reconnect', agent_id: bot.id }), {
      binding: claudeStart.binding,
    });
    expect(rskBot.status).toBe(400);

    const chatgptStart = await startConnect(owner);
    expect(chatgptStart.view.agent.reconnect_options.map((o) => o.name)).toEqual(['chatgpt']);
    const again = await connect(owner, { mode: 'reconnect', agent_id: chatgptAgent.id });
    expect((await mcpTool(again.tokens.access_token, 'whoami')).payload.name).toBe('chatgpt');
    expect((await mcpTool(chatgpt.tokens.access_token, 'whoami')).httpStatus).toBe(401);
  });

  it('a request expires', async () => {
    const owner = await signIn();
    const started = await startConnect(owner, CLAUDE);
    await getDb()
      .update(oauthAuthorizationRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthAuthorizationRequests.id, started.view.request_id));
    const late = await postConsent(owner, allowBody(started.view, { mode: 'new', name: 'claude' }), {
      binding: started.binding,
    });
    expect(late.status).toBe(410);
    expect(late.data.error.code).toBe('request_expired');
  });
});

describe('connected apps and rename', () => {
  it('is session only, scoped to the workspace', async () => {
    const owner = await signIn();
    const connected = await connect(owner, { mode: 'new', name: 'claude' }, CLAUDE);
    const helper = await createAgent(owner.cookie, 'helper');
    const key = await createKey(owner.cookie, helper.id);
    for (const bearer of [key, connected.tokens.access_token]) {
      const res = await call(listConnectedRoute, `${ISSUER}/api/v1/connected-apps`, { bearer });
      expect(res.status).toBe(403);
      expect(res.data.error.code).toBe('human_required');
    }
    const list = await call(listConnectedRoute, `${ISSUER}/api/v1/connected-apps`, { cookie: owner.cookie });
    const id = list.data.connected_apps[0].id as string;
    const stranger = await signIn();
    const res = await call(disconnectRoute, `${ISSUER}/api/v1/connected-apps/${id}/revoke`, {
      method: 'POST',
      cookie: stranger.cookie,
      params: { id },
    });
    expect(res.status).toBe(404);
    const foreign = await call(disconnectRoute, `${ISSUER}/api/v1/connected-apps/${id}/revoke`, {
      method: 'POST',
      cookie: owner.cookie,
      params: { id },
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
    expect((await mcpTool(connected.tokens.access_token, 'whoami')).isError).toBe(false);
  });

  it('PATCH /api/v1/agents/:id renames, with name_taken and invalid_name', async () => {
    const owner = await signIn();
    const connected = await connect(owner, { mode: 'new', name: 'claude' }, CLAUDE);
    await createAgent(owner.cookie, 'helper');
    const agentId = (await mcpTool(connected.tokens.access_token, 'whoami')).payload.id as string;
    const patch = (name: unknown, extra: { origin?: string; cookie?: string } = {}) =>
      call(renameRoute, `${ISSUER}/api/v1/agents/${agentId}`, {
        method: 'PATCH',
        body: { name },
        cookie: extra.cookie ?? owner.cookie,
        params: { id: agentId },
        headers: extra.origin ? { origin: extra.origin } : {},
      });
    const renamed = await patch('assistant');
    expect(renamed.status).toBe(200);
    expect(renamed.data.agent.name).toBe('assistant');
    expect((await mcpTool(connected.tokens.access_token, 'whoami')).payload.name).toBe('assistant');
    expect((await patch('helper')).data.error.code).toBe('name_taken');
    expect((await patch('no spaces')).data.error.code).toBe('invalid_name');
    expect((await patch('other', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await patch('other', { cookie: (await signIn()).cookie })).status).toBe(404);
  });
});

describe('MCP_OAUTH_ENABLED off', () => {
  it('answers 404 on every OAuth route and leaves the rsk_ path alone', async () => {
    vi.stubEnv('MCP_OAUTH_ENABLED', '');
    const owner = await signIn();
    const agent = await createAgent(owner.cookie, 'bot');
    const key = await createKey(owner.cookie, agent.id);
    const responses = [
      await prmRoute(new Request(`${ISSUER}/.well-known/oauth-protected-resource/api/mcp`), {
        params: Promise.resolve({ path: ['api', 'mcp'] }),
      }),
      await asMetadataRoute(),
      await authorizeRoute(new Request(`${ISSUER}/api/oauth/authorize?${authorizeQuery()}`)),
      (await token({ grant_type: 'authorization_code' })).res,
      (await revoke({ token: 'x' })).res,
      (await call(consentRoute, `${ISSUER}/api/oauth/consent`, { body: {}, cookie: owner.cookie })).res,
      (await call(listConnectedRoute, `${ISSUER}/api/v1/connected-apps`, { cookie: owner.cookie })).res,
      (
        await call(disconnectRoute, `${ISSUER}/api/v1/connected-apps/x/revoke`, {
          method: 'POST',
          cookie: owner.cookie,
          params: { id: '00000000-0000-4000-8000-000000000000' },
        })
      ).res,
      (
        await call(renameRoute, `${ISSUER}/api/v1/agents/${agent.id}`, {
          method: 'PATCH',
          body: { name: 'renamed' },
          cookie: owner.cookie,
          params: { id: agent.id },
        })
      ).res,
    ];
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    }
    expect((await mcpTool(key, 'whoami')).payload.name).toBe('bot');
  });
});
