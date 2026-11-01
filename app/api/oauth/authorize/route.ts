import { oauthEnabled } from '@/lib/oauth/config';
import { authorize, authorizeErrorPage } from '@/lib/oauth/authorize';
import { oauthDisabledResponse } from '@/lib/oauth/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/oauth/authorize (§2.5): validate, store the request, 302 to /oauth/consent with the binding cookie. */
export async function GET(req: Request) {
  if (!oauthEnabled()) return oauthDisabledResponse();
  try {
    return await authorize(req);
  } catch (err) {
    console.error('oauth.authorize failed', err instanceof Error ? err.name : 'error');
    return authorizeErrorPage(500, 'Something went wrong. Try again from the app.');
  }
}
