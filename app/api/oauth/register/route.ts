import { clientIp } from '@/lib/origin';
import { consumeRateLimit } from '@/lib/rate-limit';
import { dcrEnabled } from '@/lib/oauth/config';
import { OAUTH_DCR_MAX_BODY_BYTES } from '@/lib/oauth/constants';
import { OAuthError } from '@/lib/oauth/errors';
import { corsPreflight, handleOAuthProtocol, oauthDisabledResponse, rateLimited, withHeaders } from '@/lib/oauth/http';
import { registerClient } from '@/lib/oauth/register';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readJson(req: Request): Promise<unknown> {
  const type = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') throw new OAuthError('invalid_client_metadata', 'Send the body as application/json.');
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > OAUTH_DCR_MAX_BODY_BYTES) throw new OAuthError('invalid_client_metadata', 'The request body is too large.');
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > OAUTH_DCR_MAX_BODY_BYTES) {
    throw new OAuthError('invalid_client_metadata', 'The request body is too large.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new OAuthError('invalid_client_metadata', 'The body is not valid JSON.');
  }
}

/**
 * POST /api/oauth/register: RFC 7591 Dynamic Client Registration (§2.4.2), only while MCP_OAUTH_DCR=1 (404
 * otherwise). Public clients only: 201 with a client_id and token_endpoint_auth_method "none", never a secret.
 * The body is never logged.
 */
const disabled = () => withHeaders(oauthDisabledResponse(), { 'cache-control': 'no-store' });

export function POST(req: Request) {
  if (!dcrEnabled()) return disabled();
  return handleOAuthProtocol(async () => {
    const ip = clientIp(req);
    const limit = await consumeRateLimit({ kind: 'oauthRegister', ip });
    if (limit.limited) throw rateLimited(limit.retryAfterSeconds);
    const body = await readJson(req);
    return Response.json(await registerClient(body, ip), { status: 201 });
  });
}

export function OPTIONS() {
  if (!dcrEnabled()) return disabled();
  return corsPreflight();
}
