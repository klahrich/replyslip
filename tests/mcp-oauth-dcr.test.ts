import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as asMetadataRoute } from '@/app/.well-known/oauth-authorization-server/route';
import { OPTIONS as registerOptions } from '@/app/api/oauth/register/route';
import { getDb } from '@/db';
import { oauthClients, rateEvents } from '@/db/schema';
import { setCimdFetcherForTests } from '@/lib/oauth/cimd';
import { OAUTH_DCR_GLOBAL_DAILY } from '@/lib/oauth/constants';
import { pruneOAuth } from '@/lib/oauth/grants';
import { redirectKind } from '@/lib/oauth/redirect';
import { dcrClientName, impersonatesKnownApp } from '@/lib/oauth/register';
import { setOAuthClockForTests } from '@/lib/oauth/tokens';
import { call, signIn } from './helpers';
import { stubCimd } from './oauth-fixtures';
import { ISSUER, authorizeQuery, authorizeRequest, connect, postConsent, register, revoke, startConnect, token } from './oauth-flow';

/** DCR (RFC 7591), docs/design/mcp-oauth.md §2.4.2 and §5.2, plus EvaluatorBot's PR 3 criteria. */

const WEB = 'https://app.example.com/oauth/callback';
let now = Date.now();

beforeEach(async () => {
  await getDb().delete(oauthClients);
  await getDb().delete(rateEvents);
  now = Date.now();
  setOAuthClockForTests(() => now);
  vi.stubEnv('MCP_OAUTH_ENABLED', '1');
  vi.stubEnv('MCP_OAUTH_ISSUER', ISSUER);
  vi.stubEnv('MCP_OAUTH_DCR', '1');
  stubCimd();
});

afterEach(() => {
  setOAuthClockForTests(null);
  setCimdFetcherForTests(null);
  vi.unstubAllEnvs();
});

async function registered(body: Record<string, unknown> = {}) {
  const res = await register({ client_name: 'Acme MCP', redirect_uris: [WEB], ...body });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`);
  return res.data!.client_id as string;
}

describe('flag (criterion 7)', () => {
  it('MCP_OAUTH_DCR off: no registration_endpoint, /register is a no-store, noindex 404', async () => {
    vi.stubEnv('MCP_OAUTH_DCR', '');
    const as = await call(asMetadataRoute, `${ISSUER}/.well-known/oauth-authorization-server`);
    expect(as.data.registration_endpoint).toBeUndefined();
    expect(as.data.token_endpoint_auth_methods_supported).toEqual(['none']);
    const res = await register({ redirect_uris: [WEB] });
    expect(res.status).toBe(404);
    expect(res.res.headers.get('cache-control')).toBe('no-store');
    expect(res.res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.res.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await registerOptions()).status).toBe(404);
    expect(await getDb().select().from(oauthClients)).toHaveLength(0);
  });

  it('MCP_OAUTH_ENABLED off wins over MCP_OAUTH_DCR=1', async () => {
    vi.stubEnv('MCP_OAUTH_ENABLED', '');
    expect((await register({ redirect_uris: [WEB] })).status).toBe(404);
  });

  it('on: advertises the endpoint with only the none auth method, and answers CORS preflight', async () => {
    const as = await call(asMetadataRoute, `${ISSUER}/.well-known/oauth-authorization-server`);
    expect(as.data.registration_endpoint).toBe(`${ISSUER}/api/oauth/register`);
    expect(as.data.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(as.data.revocation_endpoint_auth_methods_supported).toEqual(['none']);
    expect(as.data.scopes_supported).toEqual(['agent']);
    const pre = await registerOptions();
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('public clients only (criterion 1)', () => {
  it.each(['none', 'client_secret_post', 'client_secret_basic', undefined])(
    'token_endpoint_auth_method %s is registered as none, with no secret',
    async (method) => {
      const res = await register({ redirect_uris: [WEB], token_endpoint_auth_method: method });
      expect(res.status).toBe(201);
      expect(res.data!.token_endpoint_auth_method).toBe('none');
      expect(res.data!.client_secret).toBeUndefined();
      expect(res.data!.client_secret_expires_at).toBeUndefined();
      const [row] = await getDb().select().from(oauthClients).where(eq(oauthClients.clientId, res.data!.client_id));
      expect(row).toMatchObject({ kind: 'dcr', tokenEndpointAuthMethod: 'none', clientSecretHash: null });
      expect(row!.registeredIpHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain('203.0.113.7');
    },
  );

  it('refuses private_key_jwt and unknown methods', async () => {
    for (const method of ['private_key_jwt', 'tls_client_auth', 42]) {
      const res = await register({ redirect_uris: [WEB], token_endpoint_auth_method: method });
      expect(res.status).toBe(400);
      expect(res.data!.error).toBe('invalid_client_metadata');
    }
  });

  it('a secret sent anyway (post or Basic) is ignored at /token and /revoke; client_id and PKCE still decide', async () => {
    const clientId = await registered({ token_endpoint_auth_method: 'client_secret_basic' });
    const other = await registered();
    const owner = await signIn();
    const basic = (id: string) => ({ authorization: `Basic ${Buffer.from(`${id}:rsds_made_up`).toString('base64')}` });

    const exchangeWith = async (form: Record<string, string>, headers?: Record<string, string>) => {
      const started = await startConnect(owner, { client_id: clientId, redirect_uri: WEB });
      const decided = await postConsent(
        owner,
        {
          request_id: started.view.request_id,
          csrf_token: started.view.csrf_token,
          decision: 'allow',
          workspace_id: started.view.workspaces[0]!.id,
          agent: { mode: 'new', name: `codex${Math.floor(Math.random() * 1e6)}` },
        },
        { binding: started.binding },
      );
      const code = new URL(decided.data.redirect_to).searchParams.get('code')!;
      return token(
        { grant_type: 'authorization_code', code, code_verifier: started.verifier, redirect_uri: WEB, ...form },
        headers,
      );
    };

    // client_secret_post with a made-up secret: accepted, it's a public client.
    const post = await exchangeWith({ client_id: clientId, client_secret: 'rsds_made_up' });
    expect(post.status).toBe(200);
    // client_secret_basic with a made-up secret (Codex): accepted too, and /revoke takes the same credentials.
    const viaBasic = await exchangeWith({}, basic(clientId));
    expect(viaBasic.status).toBe(200);
    const revoked = await revoke({ token: viaBasic.data.refresh_token }, basic(clientId));
    expect(revoked.status).toBe(200);
    const afterRevoke = await token({ grant_type: 'refresh_token', refresh_token: viaBasic.data.refresh_token }, basic(clientId));
    expect(afterRevoke.data.error).toBe('invalid_grant');

    // The code is bound to its client: another client's id (with any secret) can't redeem it.
    const wrongClient = await exchangeWith({ client_id: other, client_secret: 'x' });
    expect(wrongClient.status).toBe(400);
    expect(wrongClient.data.error).toBe('invalid_grant');
    const wrongBasic = await exchangeWith({}, basic(other));
    expect(wrongBasic.data.error).toBe('invalid_grant');
    // Basic naming one client and a body client_id naming another is refused.
    const mixed = await exchangeWith({ client_id: other }, basic(clientId));
    expect(mixed.status).toBe(401);
    expect(mixed.data.error).toBe('invalid_client');
    // PKCE still has to pass.
    const badPkce = await exchangeWith({ client_id: clientId, client_secret: 'x', code_verifier: 'a'.repeat(64) });
    expect(badPkce.data.error).toBe('invalid_grant');
    // An unknown client_id is still unknown.
    const unknown = await token({ grant_type: 'refresh_token', refresh_token: 'rsor_x', client_id: 'rsdc_nope', client_secret: 'x' });
    expect(unknown.data.error).toBe('invalid_client');
  });

  it('PKCE S256 is required for DCR clients', async () => {
    const clientId = await registered();
    const noPkce = await authorizeRequest(authorizeQuery({ client_id: clientId, redirect_uri: WEB, code_challenge: null }));
    expect(noPkce.status).toBe(302);
    expect(noPkce.location!.searchParams.get('error')).toBe('invalid_request');
    const plain = await authorizeRequest(
      authorizeQuery({ client_id: clientId, redirect_uri: WEB, code_challenge_method: 'plain' }),
    );
    expect(plain.location!.searchParams.get('error')).toBe('invalid_request');
  });
});

describe('redirect URIs (criterion 2)', () => {
  it.each([
    ['http, not loopback', 'http://app.example.com/cb'],
    ['wildcard', 'https://*.example.com/cb'],
    ['fragment', 'https://app.example.com/cb#x'],
    ['userinfo', 'https://user@app.example.com/cb'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,hi'],
    ['file', 'file:///tmp/cb'],
    ['blob', 'blob:https://app.example.com/x'],
    ['about', 'about:blank'],
    ['view-source', 'view-source:https://app.example.com/cb'],
    ['chrome', 'chrome://settings'],
    ['chrome-extension', 'chrome-extension://abcdef/cb'],
    ['moz-extension', 'moz-extension://abcdef/cb'],
    ['ms-browser-extension', 'ms-browser-extension://abcdef/cb'],
    ['edge', 'edge://settings'],
    ['opera', 'opera://settings'],
    ['resource', 'resource://gre/cb'],
    ['intent', 'intent://cb'],
    ['vbscript', 'vbscript:msgbox(1)'],
    ['custom scheme with fragment', 'cursor://anysphere.cursor-mcp/cb#x'],
    ['relative', '/callback'],
    ['too long', `https://app.example.com/${'a'.repeat(2001)}`],
  ])('rejects %s', async (_label, uri) => {
    const res = await register({ redirect_uris: [uri] });
    expect(res.status).toBe(400);
    expect(res.data!.error).toBe('invalid_redirect_uri');
  });

  it('rejects a missing, empty, non-array or oversized list', async () => {
    for (const redirect_uris of [undefined, [], WEB, Array.from({ length: 6 }, (_, i) => `${WEB}/${i}`)]) {
      const res = await register({ redirect_uris });
      expect(res.data!.error).toBe('invalid_redirect_uri');
    }
  });

  it('accepts any https host by default, matched exactly at /authorize', async () => {
    const clientId = await registered({ redirect_uris: ['https://tools.example.org/oauth/cb?x=1'] });
    const ok = await authorizeRequest(authorizeQuery({ client_id: clientId, redirect_uri: 'https://tools.example.org/oauth/cb?x=1' }));
    expect(ok.status).toBe(302);
    expect(ok.location!.pathname).toBe('/oauth/consent');
    for (const near of ['https://tools.example.org/oauth/cb', 'https://tools.example.org/oauth/cb?x=1&y=2', 'https://TOOLS.example.org/oauth/cb?x=1']) {
      const bad = await authorizeRequest(authorizeQuery({ client_id: clientId, redirect_uri: near }));
      expect(bad.status).toBe(400);
      expect(bad.location).toBeNull();
    }
  });

  it('loopback (RFC 8252): a portless registration matches any port; the view says loopback', async () => {
    const clientId = await registered({ redirect_uris: ['http://127.0.0.1/callback', 'http://localhost/callback'] });
    const owner = await signIn();
    const started = await startConnect(owner, { client_id: clientId, redirect_uri: 'http://127.0.0.1:54321/callback' });
    expect(started.view.redirect).toEqual({ host: '127.0.0.1', loopback: true, kind: 'loopback', scheme: null });
    const [row] = await getDb().select().from(oauthClients).where(eq(oauthClients.clientId, clientId));
    expect(row!.applicationType).toBe('native');
  });

  it('accepts private-use app schemes by default, matched exactly; the view flags them (custom_scheme)', async () => {
    const cursor = 'cursor://anysphere.cursor-mcp/oauth/callback';
    const clientId = await registered({
      client_name: 'Cursor',
      redirect_uris: [cursor, 'vscode://vscode.mcp/callback', 'com.example.app:/oauth2redirect'],
    });
    const [row] = await getDb().select().from(oauthClients).where(eq(oauthClients.clientId, clientId));
    expect(row!.applicationType).toBe('native');
    const owner = await signIn();
    const started = await startConnect(owner, { client_id: clientId, redirect_uri: cursor });
    expect(started.view.redirect).toEqual({
      host: 'anysphere.cursor-mcp',
      loopback: false,
      kind: 'custom_scheme',
      scheme: 'cursor',
    });
    expect(started.view.client).toMatchObject({ kind: 'dcr', verified: false, display_name: 'Cursor' });
    const reverse = await startConnect(owner, { client_id: clientId, redirect_uri: 'com.example.app:/oauth2redirect' });
    expect(reverse.view.redirect).toMatchObject({ kind: 'custom_scheme', scheme: 'com.example.app' });
    for (const near of ['cursor://anysphere.cursor-mcp/oauth/callback/', 'CURSOR://anysphere.cursor-mcp/oauth/callback', 'cursor://anysphere.cursor-mcp/oauth/callback?x=1']) {
      const bad = await authorizeRequest(authorizeQuery({ client_id: clientId, redirect_uri: near }));
      expect(bad.status, near).toBe(400);
    }
  });

  it('MCP_OAUTH_DCR_SCHEMES, when set, is the only list accepted; `none` turns custom schemes off', async () => {
    vi.stubEnv('MCP_OAUTH_DCR_SCHEMES', 'cursor');
    expect((await register({ redirect_uris: ['cursor://x/cb'] })).status).toBe(201);
    expect((await register({ redirect_uris: ['vscode://x/cb'] })).data!.error).toBe('invalid_redirect_uri');
    vi.stubEnv('MCP_OAUTH_DCR_SCHEMES', 'cursor,javascript,chrome-extension');
    expect((await register({ redirect_uris: ['chrome-extension://x/cb'] })).data!.error).toBe('invalid_redirect_uri');
    vi.stubEnv('MCP_OAUTH_DCR_SCHEMES', 'none');
    expect((await register({ redirect_uris: ['cursor://x/cb'] })).data!.error).toBe('invalid_redirect_uri');
    expect((await register({ redirect_uris: [WEB] })).status).toBe(201);
  });

  it('narrowing MCP_OAUTH_DCR_SCHEMES later blocks an already-registered custom-scheme client at /authorize', async () => {
    const cursor = 'cursor://anysphere.cursor-mcp/oauth/callback';
    const clientId = await registered({ redirect_uris: [cursor] });
    vi.stubEnv('MCP_OAUTH_DCR_SCHEMES', 'vscode');
    const blocked = await authorizeRequest(authorizeQuery({ client_id: clientId, redirect_uri: cursor }));
    expect(blocked.status).toBe(400);
  });

  it('MCP_OAUTH_DCR_REDIRECT_HOSTS, when set, limits https hosts but not loopback', async () => {
    vi.stubEnv('MCP_OAUTH_DCR_REDIRECT_HOSTS', 'app.example.com, claude.ai');
    expect((await register({ redirect_uris: [WEB] })).status).toBe(201);
    expect((await register({ redirect_uris: ['http://localhost/cb'] })).status).toBe(201);
    const other = await register({ redirect_uris: ['https://other.example.net/cb'] });
    expect(other.status).toBe(400);
    expect(other.data!.error).toBe('invalid_redirect_uri');
  });
});

describe('request validation and limits (criterion 3)', () => {
  it.each([
    ['grant_types client_credentials', { grant_types: ['client_credentials'] }],
    ['grant_types without authorization_code', { grant_types: ['refresh_token'] }],
    ['grant_types not an array', { grant_types: 'authorization_code' }],
    ['response_types token', { response_types: ['token'] }],
    ['application_type other', { application_type: 'service' }],
    ['client_name over 500 chars', { client_name: 'x'.repeat(501) }],
  ])('rejects %s with invalid_client_metadata', async (_label, extra) => {
    const res = await register({ redirect_uris: [WEB], ...extra });
    expect(res.status).toBe(400);
    expect(res.data!.error).toBe('invalid_client_metadata');
  });

  it('rejects non-JSON, malformed JSON, a non-object and a body over 8 KB', async () => {
    expect((await register('redirect_uris=x', { contentType: 'application/x-www-form-urlencoded' })).data!.error).toBe(
      'invalid_client_metadata',
    );
    expect((await register('{"redirect_uris":')).data!.error).toBe('invalid_client_metadata');
    expect((await register('[1,2]')).data!.error).toBe('invalid_client_metadata');
    const big = await register({ redirect_uris: [WEB], padding: 'x'.repeat(9000) });
    expect(big.status).toBe(400);
    expect(big.data!.error).toBe('invalid_client_metadata');
    expect(await getDb().select().from(oauthClients)).toHaveLength(0);
  });

  it('ignores unknown fields and logo_uri; keeps client_uri only on a redirect host', async () => {
    const res = await register({
      redirect_uris: [WEB],
      logo_uri: 'https://evil.example/logo.png',
      client_uri: 'https://chatgpt.com',
      skip_consent: true,
    });
    expect(res.status).toBe(201);
    expect(res.data!.client_uri).toBeUndefined();
    expect(res.data!.logo_uri).toBeUndefined();
    const same = await register({ redirect_uris: [WEB], client_uri: 'https://app.example.com/about' });
    expect(same.data!.client_uri).toBe('https://app.example.com');
  });

  it('rate-limits per IP (20 per 15 min) with Retry-After; another IP is unaffected', async () => {
    for (let i = 0; i < 20; i += 1) expect((await register({ redirect_uris: [WEB] }, { ip: '198.51.100.9' })).status).toBe(201);
    const limited = await register({ redirect_uris: [WEB] }, { ip: '198.51.100.9' });
    expect(limited.status).toBe(429);
    expect(limited.data!.error).toBe('rate_limited');
    expect(Number(limited.res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await register({ redirect_uris: [WEB] }, { ip: '198.51.100.10' })).status).toBe(201);
  });

  it(`caps new clients at ${OAUTH_DCR_GLOBAL_DAILY} per 24 h across all IPs`, async () => {
    await getDb()
      .insert(rateEvents)
      .values(Array.from({ length: OAUTH_DCR_GLOBAL_DAILY }, () => ({ kind: 'oauthRegisterGlobal', email: 'global', ip: null })));
    const res = await register({ redirect_uris: [WEB] }, { ip: '192.0.2.44' });
    expect(res.status).toBe(429);
    expect(await getDb().select().from(oauthClients)).toHaveLength(0);
  });
});

describe('client_name (criterion 4)', () => {
  it('strips control and bidi characters and caps at 100 characters', () => {
    expect(dcrClientName('My\u202e Notes\u0007\u200b  App')).toBe('My Notes App');
    expect(dcrClientName('n'.repeat(300))).toHaveLength(100);
    expect(dcrClientName(undefined)).toBe('Unnamed app');
    expect(dcrClientName('\u200b\u202e')).toBe('Unnamed app');
  });

  it.each([
    'ChatGPT',
    'chat gpt',
    'OpenAI Connector',
    'Claude',
    'claudeai',
    'C1aude',
    'Cl4ude Desktop',
    'Ϲlаude', // Greek lunate sigma + Cyrillic a
    'ＣｌａｕｄｅＡＩ', // fullwidth
    'C.l.a.u.d.e',
    'Anthr0pic',
    'ANTHROPIC',
    'Cha\u200btGPT',
    '0penAl',
    'CIaude', // capital I
    'Ⅽlaude', // Roman numeral C
  ])('replaces impersonating name %j', (name) => {
    expect(impersonatesKnownApp(name)).toBe(true);
    expect(dcrClientName(name)).toBe('Unnamed app');
  });

  it.each(['Cursor', 'MCP Inspector', 'Grok Bot', 'VS Code', 'Acme Notes', 'Zed'])('keeps %j', (name) => {
    expect(dcrClientName(name)).toBe(name);
  });

  it('the consent view shows a replaced name as an unverified app with the redirect host', async () => {
    const clientId = await registered({ client_name: 'Claude', redirect_uris: [WEB] });
    const owner = await signIn();
    const { view } = await startConnect(owner, { client_id: clientId, redirect_uri: WEB });
    expect(view.client).toMatchObject({ display_name: 'Unnamed app', verified: false, kind: 'dcr' });
    expect(view.redirect.host).toBe('app.example.com');
  });
});

describe('cleanup (criterion 5)', () => {
  it('pruneOAuth deletes DCR clients never used within 24 h and keeps used ones', async () => {
    const unused = await registered();
    const used = await registered();
    const owner = await signIn();
    await connect(owner, { mode: 'new', name: 'acme' }, { client_id: used, redirect_uri: WEB });
    now += 23 * 60 * 60 * 1000;
    expect((await pruneOAuth()).clients).toBe(0);
    now += 2 * 60 * 60 * 1000;
    expect((await pruneOAuth()).clients).toBe(1);
    const left = (await getDb().select().from(oauthClients)).map((row) => row.clientId);
    expect(left).toContain(used);
    expect(left).not.toContain(unused);
  });
});

describe('scope (criterion 6)', () => {
  it('a DCR registration is narrowed to agent whatever it asks for', async () => {
    const res = await register({ redirect_uris: [WEB], scope: 'agent:owner agent:respond openid offline_access' });
    expect(res.data!.scope).toBe('agent');
    const owner = await signIn();
    const { tokens } = await connect(
      owner,
      { mode: 'new', name: 'acme' },
      { client_id: res.data!.client_id, redirect_uri: WEB, scope: 'agent agent:owner' },
    );
    expect(tokens.scope).toBe('agent');
  });
});

describe('redirectKind (ConsentView.redirect.kind)', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', 'https', null],
    ['http://127.0.0.1:3000/cb', 'loopback', null],
    ['http://localhost/cb', 'loopback', null],
    ['http://[::1]:8080/cb', 'loopback', null],
    ['cursor://anysphere.cursor-mcp/oauth/callback', 'custom_scheme', 'cursor'],
    ['VSCode://x/cb', 'custom_scheme', 'vscode'],
  ])('%s → %s', (uri, kind, scheme) => {
    expect(redirectKind(uri)).toEqual({ kind, scheme });
  });
});
