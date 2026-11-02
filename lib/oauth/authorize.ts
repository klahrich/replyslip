import { getDb } from '@/db';
import { oauthAuthorizationRequests } from '@/db/schema';
import { sha256 } from '../crypto';
import { readCookie } from '../http';
import { clientIp } from '../origin';
import { consumeRateLimit } from '../rate-limit';
import { resolveClient } from './clients';
import { absoluteIssuerUrl, dcrSchemePolicy, grantableScope, normalizeResource, oauthIssuer, oauthResource } from './config';
import {
  OAUTH_BINDING_COOKIE,
  OAUTH_BINDING_COOKIE_MAX,
  OAUTH_REQUEST_TTL_MS,
  OAUTH_STATE_MAX_BYTES,
} from './constants';
import { OAuthError, type OAuthErrorCode } from './errors';
import { isSupportedChallengeMethod, isValidCodeChallenge } from './pkce';
import { checkRedirectUri, redirectUriMatches, withQuery } from './redirect';
import { mintOpaque, oauthNow } from './tokens';

/** GET /api/oauth/authorize (docs/design/mcp-oauth.md §2.5). */

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
} as const;

const REDIRECT_HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
} as const;

/** A plain page on valetto.tech. Used before the client and redirect_uri are trusted, so nothing redirects. */
export function authorizeErrorPage(status: number, message: string): Response {
  const body =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow">' +
    '<meta name="referrer" content="no-referrer"><title>Can’t connect this app · Valetto</title></head>' +
    '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">' +
    `<h1 style="font-size:1.25rem">Can’t connect this app</h1><p>${message}</p>` +
    '<p>Go back to the app and try again.</p></body></html>';
  return new Response(body, { status, headers: PAGE_HEADERS });
}

/** Explicitly 302, never NextResponse.redirect's default 307. */
function found(location: string, extra: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { location, ...REDIRECT_HEADERS, ...extra } });
}

/** Error back to the client: redirect_uri?error=…&error_description=…&state=…&iss=… (RFC 9207 iss on errors too). */
export function clientErrorRedirect(
  redirectUri: string,
  error: OAuthErrorCode,
  description: string,
  state: string | null,
): Response {
  return found(withQuery(redirectUri, { error, error_description: description, state, iss: oauthIssuer() }));
}

/** Values already in the __Host- cookie, newest last; malformed parts are dropped. */
function bindingValues(req: Request): string[] {
  const raw = readCookie(req, OAUTH_BINDING_COOKIE) ?? '';
  return raw.split('.').filter((part) => /^[A-Za-z0-9_-]{43}$/.test(part));
}

export function bindingCookie(values: string[]): string {
  const kept = values.slice(-OAUTH_BINDING_COOKIE_MAX);
  return [
    `${OAUTH_BINDING_COOKIE}=${kept.join('.')}`,
    'Path=/',
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.round(OAUTH_REQUEST_TTL_MS / 1000)}`,
  ].join('; ');
}

/** True when one of the browser's binding values hashes to the request's binding_hash. */
export function bindingMatches(req: Request, bindingHash: string): boolean {
  return bindingValues(req).some((value) => sha256(value) === bindingHash);
}

function single(params: URLSearchParams, name: string): { value: string | null; repeated: boolean } {
  const all = params.getAll(name);
  return { value: all[0] ?? null, repeated: all.length > 1 };
}

export async function authorize(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;

  // Rate limit before any CIMD fetch or insert. Still a page, never a redirect.
  const limit = await consumeRateLimit({ kind: 'oauthAuthorize', ip: clientIp(req) });
  if (limit.limited) {
    const res = authorizeErrorPage(429, 'Too many sign-in attempts from this network. Wait a few minutes.');
    res.headers.set('retry-after', String(limit.retryAfterSeconds));
    return res;
  }

  // 1. Client and redirect_uri. Any failure here is a page on valetto.tech, never a redirect.
  const clientId = single(params, 'client_id');
  const redirect = single(params, 'redirect_uri');
  if (clientId.repeated || redirect.repeated || !clientId.value) {
    return authorizeErrorPage(400, 'The app sent an incomplete request (client_id).');
  }
  let client;
  try {
    client = await resolveClient(clientId.value, { refresh: true });
  } catch (err) {
    if (err instanceof OAuthError && err.status < 500) {
      return authorizeErrorPage(400, 'This app isn’t allowed to connect to Valetto.');
    }
    console.error('oauth.authorize client resolution failed');
    return authorizeErrorPage(502, 'We couldn’t check this app right now.');
  }
  const redirectUri = redirect.value;
  if (
    !redirectUri ||
    !checkRedirectUri(redirectUri, client.kind === 'dcr' ? dcrSchemePolicy() : []).ok ||
    !redirectUriMatches(client.redirectUris, redirectUri)
  ) {
    return authorizeErrorPage(400, 'The app asked to return to an address it didn’t register.');
  }

  // 2. From here on, errors go back to the client.
  const state = single(params, 'state');
  const stateValue = state.value;
  const back = (code: OAuthErrorCode, description: string) =>
    clientErrorRedirect(redirectUri, code, description, stateValue !== null && Buffer.byteLength(stateValue) <= OAUTH_STATE_MAX_BYTES ? stateValue : null);
  for (const name of ['response_type', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource']) {
    if (single(params, name).repeated) return back('invalid_request', 'A parameter was sent more than once.');
  }
  if (stateValue !== null && Buffer.byteLength(stateValue) > OAUTH_STATE_MAX_BYTES) {
    return back('invalid_request', 'state is too long.');
  }
  if (params.get('response_type') !== 'code') {
    return back('unsupported_response_type', 'Only response_type=code is supported.');
  }
  const codeChallenge = params.get('code_challenge');
  if (!isValidCodeChallenge(codeChallenge) || !isSupportedChallengeMethod(params.get('code_challenge_method'))) {
    return back('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }
  const rawResource = params.get('resource');
  const resource = rawResource === null ? oauthResource() : normalizeResource(rawResource);
  if (!resource) return back('invalid_target', 'Unknown resource.');
  const scope = grantableScope(params.get('scope'));

  // 4. Store the request and send the browser to the consent page with a fresh binding value.
  const request = mintOpaque();
  const binding = mintOpaque();
  await getDb()
    .insert(oauthAuthorizationRequests)
    .values({
      requestHash: request.hash,
      bindingHash: binding.hash,
      clientId: client.id,
      redirectUri,
      state: stateValue,
      codeChallenge,
      scope,
      resource,
      expiresAt: new Date(oauthNow().getTime() + OAUTH_REQUEST_TTL_MS),
    });
  return found(absoluteIssuerUrl(`/oauth/consent?req=${request.token}`), {
    'set-cookie': bindingCookie([...bindingValues(req), binding.token]),
  });
}
