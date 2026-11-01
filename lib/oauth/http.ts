import { HttpError } from '../errors';
import { handle, json } from '../http';
import { oauthEnabled } from './config';
import { OAuthError } from './errors';

/**
 * Response helpers for the OAuth routes (docs/design/mcp-oauth.md §2). Every OAuth JSON response is no-store; token,
 * register and revoke also send Pragma: no-cache. Machine endpoints allow any origin without credentials.
 */

export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
  'access-control-max-age': '86400',
} as const;

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' } as const;

/**
 * On every OAuth response, success or error, flag on or off (SeoBot, §5.4). next.config.ts sends the same through
 * /api/:path* and CUSTOMER_API; setting them here too keeps them when the route is called directly.
 */
export const PRIVATE_HEADERS = { 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' } as const;

export function withHeaders(response: Response, headers: Record<string, string>): Response {
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

/** 404 with the normal error envelope: what every OAuth route answers while MCP_OAUTH_ENABLED is off. */
export function oauthDisabledResponse(): Response {
  return json({ error: { code: 'not_found', message: 'Not found.' } }, 404, { ...PRIVATE_HEADERS });
}

/** Token, revoke and register: RFC 6749 §5.1 headers, CORS, and RFC 6749 §5.2 errors. */
export async function handleOAuthProtocol(fn: () => Promise<Response>): Promise<Response> {
  if (!oauthEnabled()) return oauthDisabledResponse();
  let response: Response;
  try {
    response = await fn();
  } catch (err) {
    response = oauthErrorResponse(err);
  }
  return withHeaders(response, { ...NO_STORE, ...CORS_HEADERS, ...PRIVATE_HEADERS });
}

export function oauthErrorResponse(err: unknown): Response {
  if (err instanceof OAuthError) {
    const headers: Record<string, string> = {};
    if (err.code === 'invalid_client') headers['www-authenticate'] = 'Basic realm="valetto"';
    return json(err.toJSON(), err.status, headers);
  }
  if (err instanceof HttpError && err.code === 'rate_limited') {
    const retry = (err.details as { retry_after_seconds?: number } | undefined)?.retry_after_seconds;
    return json(
      { error: 'rate_limited', error_description: 'Too many requests. Try again later.' },
      429,
      retry ? { 'retry-after': String(retry) } : undefined,
    );
  }
  console.error(err instanceof Error ? err.name : 'oauth error');
  return json({ error: 'server_error', error_description: 'Something went wrong.' }, 500);
}

/** Session routes (consent, connected apps): the normal error envelope, plus no-store and no-referrer. */
export async function handleOAuthSession(fn: () => Promise<Response>): Promise<Response> {
  if (!oauthEnabled()) return withHeaders(oauthDisabledResponse(), { 'cache-control': 'private, no-store' });
  const response = await handle(fn);
  return withHeaders(response, { 'cache-control': 'private, no-store', ...PRIVATE_HEADERS });
}

export function corsPreflight(): Response {
  if (!oauthEnabled()) return oauthDisabledResponse();
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS, ...PRIVATE_HEADERS } });
}

/** /token and /revoke take application/x-www-form-urlencoded only (JSON is invalid_request). */
export async function readForm(req: Request): Promise<URLSearchParams> {
  const type = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') {
    throw new OAuthError('invalid_request', 'Send the body as application/x-www-form-urlencoded.');
  }
  const text = await req.text();
  if (text.length > 16 * 1024) throw new OAuthError('invalid_request', 'The request body is too large.');
  const form = new URLSearchParams(text);
  for (const name of new Set(form.keys())) {
    if (form.getAll(name).length > 1) throw new OAuthError('invalid_request', 'A parameter was sent more than once.');
  }
  return form;
}

export function rateLimited(retryAfterSeconds: number): HttpError {
  return new HttpError(429, 'rate_limited', 'Too many requests. Try again later.', { retry_after_seconds: retryAfterSeconds });
}
