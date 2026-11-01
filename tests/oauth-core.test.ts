import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkCimdUrl,
  cimdCacheMs,
  isCimdClientId,
  isPrivateAddress,
  parseCimdDocument,
  sanitizeClientName,
  setCimdFetcherForTests,
  type CimdResponse,
} from '@/lib/oauth/cimd';
import {
  DEFAULT_ISSUER,
  cimdHosts,
  grantableScope,
  normalizeResource,
  oauthEnabled,
  oauthIssuer,
  oauthResource,
  validateOAuthConfig,
} from '@/lib/oauth/config';
import { agentNameBase } from '@/lib/oauth/grants';
import { isConsentNextPath, safeNextPath } from '@/lib/oauth/next-path';
import { isSupportedChallengeMethod, isValidCodeChallenge, s256, verifyPkce } from '@/lib/oauth/pkce';
import { checkRedirectUri, redirectHost, redirectUriMatches, withQuery } from '@/lib/oauth/redirect';
import { OAUTH_TOKEN_PATTERN, mintToken } from '@/lib/oauth/tokens';
import { CHATGPT_CLIENT_ID, CIMD_DOCUMENTS, CLAUDE_CLIENT_ID, CLAUDE_CODE_CLIENT_ID, jsonResponse } from './oauth-fixtures';

afterEach(() => {
  vi.unstubAllEnvs();
  setCimdFetcherForTests(null);
});

describe('config', () => {
  it('is off unless MCP_OAUTH_ENABLED=1', () => {
    vi.stubEnv('MCP_OAUTH_ENABLED', '');
    expect(oauthEnabled()).toBe(false);
    vi.stubEnv('MCP_OAUTH_ENABLED', 'true');
    expect(oauthEnabled()).toBe(false);
    vi.stubEnv('MCP_OAUTH_ENABLED', '1');
    expect(oauthEnabled()).toBe(true);
  });

  it('pins the issuer from env, never from a request', () => {
    vi.stubEnv('MCP_OAUTH_ISSUER', '');
    expect(oauthIssuer()).toBe(DEFAULT_ISSUER);
    vi.stubEnv('MCP_OAUTH_ISSUER', 'https://preview.example.com');
    expect(oauthIssuer()).toBe('https://preview.example.com');
    expect(oauthResource()).toBe('https://preview.example.com/api/mcp');
  });

  it('refuses a non-canonical issuer once the flag is on, and ignores it while off', () => {
    vi.stubEnv('MCP_OAUTH_ISSUER', 'https://valetto.tech/');
    vi.stubEnv('MCP_OAUTH_ENABLED', '');
    expect(oauthIssuer()).toBe(DEFAULT_ISSUER);
    expect(() => validateOAuthConfig()).not.toThrow();
    vi.stubEnv('MCP_OAUTH_ENABLED', '1');
    expect(() => validateOAuthConfig()).toThrow(/canonical/);
  });

  it('needs MCP_OAUTH_ISSUER in production with the flag on', () => {
    vi.stubEnv('MCP_OAUTH_ENABLED', '1');
    vi.stubEnv('MCP_OAUTH_ISSUER', '');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(() => validateOAuthConfig()).toThrow(/MCP_OAUTH_ISSUER/);
  });

  it('defaults the CIMD allowlist to chatgpt.com and claude.ai', () => {
    vi.stubEnv('MCP_OAUTH_CIMD_HOSTS', '');
    expect(cimdHosts()).toEqual(['chatgpt.com', 'claude.ai']);
    vi.stubEnv('MCP_OAUTH_CIMD_HOSTS', ' Claude.ai ');
    expect(cimdHosts()).toEqual(['claude.ai']);
  });

  it('normalizes resource case and one trailing slash only', () => {
    vi.stubEnv('MCP_OAUTH_ISSUER', 'https://valetto.tech');
    expect(normalizeResource('https://valetto.tech/api/mcp')).toBe('https://valetto.tech/api/mcp');
    expect(normalizeResource('HTTPS://VALETTO.TECH/api/mcp/')).toBe('https://valetto.tech/api/mcp');
    expect(normalizeResource('https://valetto.tech/api/MCP')).toBeNull();
    expect(normalizeResource('https://valetto.tech')).toBeNull();
    expect(normalizeResource('https://valetto.tech/api/mcp?x=1')).toBeNull();
    expect(normalizeResource('https://evil.example/api/mcp')).toBeNull();
  });

  it('keeps only the agent scope', () => {
    expect(grantableScope('agent offline_access openid')).toBe('agent');
    expect(grantableScope('agent:respond agent:owner')).toBe('agent');
    expect(grantableScope('')).toBe('agent');
    expect(grantableScope(null)).toBe('agent');
  });
});

describe('redirect URIs', () => {
  it('matches exactly, without normalizing', () => {
    const registered = ['https://chatgpt.com/connector_platform_oauth_redirect'];
    expect(redirectUriMatches(registered, 'https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
    expect(redirectUriMatches(registered, 'https://chatgpt.com/connector_platform_oauth_redirect/')).toBe(false);
    expect(redirectUriMatches(registered, 'https://ChatGPT.com/connector_platform_oauth_redirect')).toBe(false);
    expect(redirectUriMatches(registered, 'https://chatgpt.com/connector_platform_oauth_redirect?x=1')).toBe(false);
    expect(redirectUriMatches(registered, 'https://chatgpt.com:443/connector_platform_oauth_redirect')).toBe(false);
  });

  it('lets a portless loopback registration match any port, for loopback hosts only', () => {
    const registered = ['http://localhost/callback', 'http://127.0.0.1/callback', 'http://[::1]/callback'];
    expect(redirectUriMatches(registered, 'http://localhost:53682/callback')).toBe(true);
    expect(redirectUriMatches(registered, 'http://127.0.0.1:1/callback')).toBe(true);
    expect(redirectUriMatches(registered, 'http://[::1]:8080/callback')).toBe(true);
    expect(redirectUriMatches(registered, 'http://localhost:53682/callback/')).toBe(false);
    expect(redirectUriMatches(registered, 'http://localhost:53682/other')).toBe(false);
    expect(redirectUriMatches(registered, 'http://localhost.evil.com:80/callback')).toBe(false);
    expect(redirectUriMatches(['https://claude.ai/cb'], 'https://claude.ai:8443/cb')).toBe(false);
    expect(redirectUriMatches(['http://localhost:3000/callback'], 'http://localhost:4000/callback')).toBe(false);
  });

  it('refuses http to other hosts, fragments, userinfo, wildcards and script schemes', () => {
    expect(checkRedirectUri('https://chatgpt.com/cb').ok).toBe(true);
    expect(checkRedirectUri('http://localhost/cb').ok).toBe(true);
    for (const bad of [
      'http://evil.example/cb',
      'https://chatgpt.com/cb#frag',
      'https://user:pass@chatgpt.com/cb',
      'https://user@chatgpt.com/cb',
      'https://*.chatgpt.com/cb',
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'cursor://callback',
      'relative/path',
      'https://chatgpt.com/c b',
    ]) {
      expect(checkRedirectUri(bad).ok, bad).toBe(false);
    }
    expect(checkRedirectUri('cursor://anysphere.cursor-retrieval/oauth', ['cursor']).ok).toBe(true);
  });

  it('shows the host and appends params without dropping an existing query', () => {
    expect(redirectHost('https://chatgpt.com/connector_platform_oauth_redirect')).toBe('chatgpt.com');
    expect(redirectHost('http://localhost:5000/callback')).toBe('localhost');
    expect(withQuery('https://a.example/cb', { code: 'c', state: 'a b', iss: 'https://valetto.tech' })).toBe(
      'https://a.example/cb?code=c&state=a+b&iss=https%3A%2F%2Fvaletto.tech',
    );
    expect(withQuery('https://a.example/cb?x=1', { code: 'c', state: null })).toBe('https://a.example/cb?x=1&code=c');
  });
});

describe('PKCE', () => {
  it('accepts a correct S256 verifier', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(s256(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(verifyPkce(verifier, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true);
    expect(verifyPkce(`${verifier}x`, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
  });

  it('refuses plain, a missing method, and bad verifier length or charset', () => {
    expect(isSupportedChallengeMethod('S256')).toBe(true);
    expect(isSupportedChallengeMethod('plain')).toBe(false);
    expect(isSupportedChallengeMethod(undefined)).toBe(false);
    expect(isSupportedChallengeMethod(null)).toBe(false);
    expect(isValidCodeChallenge('a'.repeat(42))).toBe(false);
    expect(isValidCodeChallenge('a'.repeat(129))).toBe(false);
    expect(isValidCodeChallenge('a'.repeat(43))).toBe(true);
    expect(verifyPkce('short', s256('short'))).toBe(false);
    expect(verifyPkce(`${'a'.repeat(42)}!`, s256(`${'a'.repeat(42)}!`))).toBe(false);
    expect(verifyPkce('a'.repeat(129), s256('a'.repeat(129)))).toBe(false);
  });
});

describe('safeNextPath', () => {
  const good = `/oauth/consent?req=${'A'.repeat(43)}`;

  it('accepts only the consent path', () => {
    expect(safeNextPath(good)).toBe(good);
    expect(isConsentNextPath(good)).toBe(true);
  });

  it.each([
    '//evil.com',
    '/\\evil.com',
    '%2F%2Fevil.com',
    'https://evil.com',
    'https://valetto.tech/oauth/consent?req=' + 'A'.repeat(43),
    `/oauth/consent?req=x&next=//evil.com`,
    `${good}&next=//evil.com`,
    `${good}#x`,
    `/oauth/consent?req=${'A'.repeat(42)}`,
    `/oauth/consent?req=${'A'.repeat(44)}`,
    '/oauth/consent%3Freq%3D' + 'A'.repeat(43),
    '/dashboard/../evil',
    '',
    undefined,
    null,
    42,
  ])('falls back to /dashboard for %s', (value) => {
    expect(safeNextPath(value)).toBe('/dashboard');
  });
});

describe('tokens', () => {
  it('mints distinct prefixes that the scrubber matches', () => {
    for (const kind of ['access', 'refresh', 'code', 'dcrClientId', 'dcrClientSecret'] as const) {
      const { token, hash } = mintToken(kind);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(token.match(OAUTH_TOKEN_PATTERN)).toEqual([token]);
    }
  });
});

describe('agent name from a client', () => {
  it('lowercases and dashes the client name', () => {
    expect(agentNameBase('ChatGPT')).toBe('chatgpt');
    expect(agentNameBase('Claude')).toBe('claude');
    expect(agentNameBase('Claude Code')).toBe('claude-code');
    expect(agentNameBase('  ***  ')).toBe('app');
    expect(agentNameBase('123 Bot')).toBe('bot');
  });
});

describe('CIMD', () => {
  it('recognizes CIMD client ids', () => {
    expect(isCimdClientId(CHATGPT_CLIENT_ID)).toBe(true);
    expect(isCimdClientId('https://chatgpt.com')).toBe(false);
    expect(isCimdClientId('https://chatgpt.com/')).toBe(false);
    expect(isCimdClientId('rsdc_abc')).toBe(false);
  });

  it('refuses a non-allowlisted host, http, an IP literal, a port, userinfo and a fragment', () => {
    expect(() => checkCimdUrl(CLAUDE_CLIENT_ID)).not.toThrow();
    for (const bad of [
      'https://evil.example/client.json',
      'http://chatgpt.com/oauth/client.json',
      'https://93.184.216.34/client.json',
      'https://[2606:4700::1]/client.json',
      'https://chatgpt.com:8443/oauth/client.json',
      'https://user@chatgpt.com/oauth/client.json',
      'https://chatgpt.com/oauth/client.json#x',
      'https://chatgpt.com.evil.example/oauth/client.json',
    ]) {
      expect(() => checkCimdUrl(bad), bad).toThrow();
    }
  });

  it('treats private, loopback, link-local, CGNAT, ULA and multicast addresses as private', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      'fc00::1',
      'fd12::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      'not-an-ip',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    expect(isPrivateAddress('104.18.32.47')).toBe(false);
    expect(isPrivateAddress('2606:4700::6812:202f')).toBe(false);
  });

  it('accepts the live ChatGPT, Claude and Claude Code documents', () => {
    const chatgpt = parseCimdDocument(CHATGPT_CLIENT_ID, jsonResponse(CIMD_DOCUMENTS[CHATGPT_CLIENT_ID]));
    expect(chatgpt).toMatchObject({
      clientName: 'ChatGPT',
      clientUri: 'https://chatgpt.com',
      redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      grantTypes: ['authorization_code', 'refresh_token'],
    });
    const claude = parseCimdDocument(CLAUDE_CLIENT_ID, jsonResponse(CIMD_DOCUMENTS[CLAUDE_CLIENT_ID]));
    expect(claude.redirectUris).toEqual(['https://claude.ai/api/mcp/auth_callback']);
    expect(claude.grantTypes).toEqual(['authorization_code', 'refresh_token']);
    const code = parseCimdDocument(CLAUDE_CODE_CLIENT_ID, jsonResponse(CIMD_DOCUMENTS[CLAUDE_CODE_CLIENT_ID]));
    expect(code.clientName).toBe('Claude Code');
    expect(code.redirectUris).toEqual(['http://localhost/callback', 'http://127.0.0.1/callback']);
  });

  it('refuses a mismatched client_id, a redirect, an oversize or non-JSON body and a missing none method', () => {
    const doc = CIMD_DOCUMENTS[CLAUDE_CLIENT_ID]!;
    const cases: Array<[string, CimdResponse]> = [
      ['mismatch', jsonResponse({ ...doc, client_id: 'https://claude.ai/other' })],
      ['redirect', { status: 302, contentType: null, cacheControl: null, body: '' }],
      ['not found', { status: 404, contentType: 'application/json', cacheControl: null, body: '{}' }],
      ['oversize', jsonResponse({ ...doc, padding: 'x'.repeat(9000) })],
      ['html', { status: 200, contentType: 'text/html', cacheControl: null, body: JSON.stringify(doc) }],
      ['bad json', { status: 200, contentType: 'application/json', cacheControl: null, body: '{' }],
      ['secret method', jsonResponse({ ...doc, token_endpoint_auth_method: 'client_secret_basic' })],
      ['no method', jsonResponse({ ...doc, token_endpoint_auth_method: undefined })],
      ['no redirects', jsonResponse({ ...doc, redirect_uris: [] })],
      ['only bad redirects', jsonResponse({ ...doc, redirect_uris: ['http://evil.example/cb'] })],
      ['no code grant', jsonResponse({ ...doc, grant_types: ['refresh_token'] })],
    ];
    for (const [label, response] of cases) {
      expect(() => parseCimdDocument(CLAUDE_CLIENT_ID, response), label).toThrow();
    }
  });

  it('strips control and bidi characters from client_name and caps it at 100', () => {
    expect(sanitizeClientName('Chat\u202eGPT\u0000 ')).toBe('ChatGPT');
    expect(sanitizeClientName('x'.repeat(200))).toHaveLength(100);
  });

  it('clamps the cache TTL to 5 min–24 h', () => {
    expect(cimdCacheMs('public, max-age=300')).toBe(300_000);
    expect(cimdCacheMs('max-age=10')).toBe(300_000);
    expect(cimdCacheMs('max-age=999999')).toBe(86_400_000);
    expect(cimdCacheMs(null)).toBe(300_000);
    expect(cimdCacheMs('no-store')).toBe(300_000);
  });
});
