import { json } from '@/lib/http';
import { clientIp } from '@/lib/origin';
import { consumeRateLimit } from '@/lib/rate-limit';
import { authenticateClient, readClientCredentials, touchClient } from '@/lib/oauth/clients';
import { OAuthError } from '@/lib/oauth/errors';
import { exchangeAuthorizationCode, refreshGrant } from '@/lib/oauth/grants';
import { corsPreflight, handleOAuthProtocol, rateLimited, readForm } from '@/lib/oauth/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/oauth/token (§2.7): authorization_code and refresh_token, form-urlencoded only. */
export function POST(req: Request) {
  return handleOAuthProtocol(async () => {
    const limit = await consumeRateLimit({ kind: 'oauthToken', ip: clientIp(req) });
    if (limit.limited) throw rateLimited(limit.retryAfterSeconds);
    const form = await readForm(req);
    const client = await authenticateClient(readClientCredentials(req.headers.get('authorization'), form));
    const grantType = form.get('grant_type');
    let body;
    if (grantType === 'authorization_code') {
      body = await exchangeAuthorizationCode({
        client,
        code: form.get('code'),
        codeVerifier: form.get('code_verifier'),
        redirectUri: form.get('redirect_uri'),
        resource: form.get('resource'),
      });
    } else if (grantType === 'refresh_token') {
      body = await refreshGrant(
        { client, refreshToken: form.get('refresh_token'), scope: form.get('scope'), resource: form.get('resource') },
        {
          beforeRotate: async (grantId) => {
            const perGrant = await consumeRateLimit({ kind: 'oauthRefresh', agentId: grantId });
            if (perGrant.limited) throw rateLimited(perGrant.retryAfterSeconds);
          },
        },
      );
    } else if (!grantType) {
      throw new OAuthError('invalid_request', 'grant_type is required.');
    } else {
      throw new OAuthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
    }
    await touchClient(client.id);
    return json(body);
  });
}

export function OPTIONS() {
  return corsPreflight();
}
