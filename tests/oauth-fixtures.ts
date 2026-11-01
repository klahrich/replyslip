import { createHash, randomBytes } from 'node:crypto';
import { setCimdFetcherForTests, type CimdResponse } from '@/lib/oauth/cimd';

/** Live CIMD documents, as served on 2026-11-01 (public client metadata, no secrets). The network is always stubbed. */
export const CHATGPT_CLIENT_ID = 'https://chatgpt.com/oauth/client.json';
export const CLAUDE_CLIENT_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
export const CLAUDE_CODE_CLIENT_ID = 'https://claude.ai/oauth/claude-code-client-metadata';

export const CIMD_DOCUMENTS: Record<string, Record<string, unknown>> = {
  [CHATGPT_CLIENT_ID]: {
    client_id: CHATGPT_CLIENT_ID,
    client_uri: 'https://chatgpt.com/',
    redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_name: 'ChatGPT',
    logo_uri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png',
    token_endpoint_auth_signing_alg: 'RS256',
    jwks_uri: 'https://chatgpt.com/oauth/jwks.json',
  },
  [CLAUDE_CLIENT_ID]: {
    client_id: CLAUDE_CLIENT_ID,
    client_name: 'Claude',
    client_uri: 'https://claude.ai',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:jwt-bearer'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  },
  [CLAUDE_CODE_CLIENT_ID]: {
    client_id: CLAUDE_CODE_CLIENT_ID,
    client_name: 'Claude Code',
    client_uri: 'https://claude.ai',
    redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  },
};

export function jsonResponse(doc: unknown, cacheControl: string | null = 'public, max-age=300'): CimdResponse {
  return { status: 200, contentType: 'application/json', cacheControl, body: JSON.stringify(doc) };
}

/** Stub the CIMD network with the fixtures. Returns a counter of fetches per URL. */
export function stubCimd(overrides: Record<string, CimdResponse | Error> = {}): Map<string, number> {
  const calls = new Map<string, number>();
  setCimdFetcherForTests(async (url) => {
    const key = url.toString();
    calls.set(key, (calls.get(key) ?? 0) + 1);
    const override = overrides[key];
    if (override instanceof Error) throw override;
    if (override) return override;
    const doc = CIMD_DOCUMENTS[key];
    if (!doc) return { status: 404, contentType: 'text/plain', cacheControl: null, body: '' };
    return jsonResponse(doc);
  });
  return calls;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
