import { GET as authorizeRoute } from '@/app/api/oauth/authorize/route';
import { POST as consentRoute } from '@/app/api/oauth/consent/route';
import { POST as revokeRoute } from '@/app/api/oauth/revoke/route';
import { POST as tokenRoute } from '@/app/api/oauth/token/route';
import { requireUser } from '@/lib/auth';
import { loadConsentRequest, type ConsentView } from '@/lib/oauth/consent';
import { call } from './helpers';
import { CHATGPT_CLIENT_ID, pkcePair } from './oauth-fixtures';

/** A fake MCP client driving the real OAuth routes (docs/design/mcp-oauth.md §7). */

export const ISSUER = 'https://valetto.tech';
export const RESOURCE = `${ISSUER}/api/mcp`;
export const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
export const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

export type Owner = { cookie: string; email: string };

export function authorizeQuery(overrides: Record<string, string | null> = {}, challenge = pkcePair().challenge) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CHATGPT_CLIENT_ID,
    redirect_uri: CHATGPT_REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-123',
    resource: RESOURCE,
    scope: 'agent',
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return params;
}

export async function authorizeRequest(params: URLSearchParams) {
  const res = await authorizeRoute(new Request(`${ISSUER}/api/oauth/authorize?${params}`));
  const location = res.headers.get('location');
  const setCookie = res.headers.get('set-cookie');
  return {
    res,
    status: res.status,
    location: location ? new URL(location) : null,
    binding: setCookie ? setCookie.split(';')[0]! : null,
    text: await res.text(),
  };
}

/** /authorize, then the consent page's data for this signed-in owner. */
export async function startConnect(
  owner: Owner,
  overrides: Record<string, string | null> = {},
): Promise<{ view: ConsentView; binding: string; verifier: string; reqToken: string }> {
  const { verifier, challenge } = pkcePair();
  const started = await authorizeRequest(authorizeQuery(overrides, challenge));
  if (started.status !== 302 || !started.location || !started.binding) {
    throw new Error(`authorize failed: ${started.status} ${started.text}`);
  }
  const reqToken = started.location.searchParams.get('req')!;
  const view = await loadConsentRequest(reqToken, await sessionOf(owner));
  return { view, binding: started.binding, verifier, reqToken };
}

export async function sessionOf(owner: Owner) {
  return requireUser(new Request(`${ISSUER}/oauth/consent`, { headers: { cookie: owner.cookie } }));
}

export async function postConsent(
  owner: Owner,
  body: Record<string, unknown>,
  options: { binding?: string | null; origin?: string } = {},
) {
  const cookie = [owner.cookie, options.binding].filter(Boolean).join('; ');
  return call(consentRoute, `${ISSUER}/api/oauth/consent`, {
    body,
    cookie,
    headers: { origin: options.origin ?? ISSUER },
  });
}

export async function postForm(
  handler: typeof tokenRoute | typeof revokeRoute,
  path: string,
  form: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const res = await handler(
    new Request(`${ISSUER}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(form).toString(),
    }),
  );
  const text = await res.text();
  return { status: res.status, res, text, data: text ? JSON.parse(text) : null };
}

export const token = (form: Record<string, string>, headers?: Record<string, string>) =>
  postForm(tokenRoute, '/api/oauth/token', form, headers);
export const revoke = (form: Record<string, string>) => postForm(revokeRoute, '/api/oauth/revoke', form);

/** The whole public-client flow: authorize, Allow, code exchange. */
export async function connect(
  owner: Owner,
  agent: { mode: 'new'; name: string } | { mode: 'reconnect'; agent_id: string } = { mode: 'new', name: 'chatgpt' },
  overrides: Record<string, string | null> = {},
) {
  const started = await startConnect(owner, overrides);
  const decided = await postConsent(
    owner,
    {
      request_id: started.view.request_id,
      csrf_token: started.view.csrf_token,
      decision: 'allow',
      workspace_id: started.view.workspaces[0]!.id,
      agent,
    },
    { binding: started.binding },
  );
  if (decided.status !== 200) throw new Error(`consent failed: ${decided.status} ${decided.text}`);
  const back = new URL(decided.data.redirect_to);
  const redirectUri = overrides.redirect_uri ?? CHATGPT_REDIRECT;
  const exchanged = await token({
    grant_type: 'authorization_code',
    code: back.searchParams.get('code')!,
    code_verifier: started.verifier,
    redirect_uri: redirectUri,
    client_id: overrides.client_id ?? CHATGPT_CLIENT_ID,
    resource: RESOURCE,
  });
  if (exchanged.status !== 200) throw new Error(`token failed: ${exchanged.status} ${exchanged.text}`);
  return { ...started, back, tokens: exchanged.data as { access_token: string; refresh_token?: string; expires_in: number; scope: string } };
}
