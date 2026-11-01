import { clientIp } from '@/lib/origin';
import { consumeRateLimit } from '@/lib/rate-limit';
import { authenticateClient, readClientCredentials } from '@/lib/oauth/clients';
import { revokeToken } from '@/lib/oauth/grants';
import { corsPreflight, handleOAuthProtocol, rateLimited, readForm } from '@/lib/oauth/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/oauth/revoke (RFC 7009, §2.8). Always 200 with an empty body once the client authenticates. */
export function POST(req: Request) {
  return handleOAuthProtocol(async () => {
    const limit = await consumeRateLimit({ kind: 'oauthRevoke', ip: clientIp(req) });
    if (limit.limited) throw rateLimited(limit.retryAfterSeconds);
    const form = await readForm(req);
    const client = await authenticateClient(readClientCredentials(req.headers.get('authorization'), form));
    await revokeToken({ client, token: form.get('token'), hint: form.get('token_type_hint') });
    return new Response(null, { status: 200 });
  });
}

export function OPTIONS() {
  return corsPreflight();
}
