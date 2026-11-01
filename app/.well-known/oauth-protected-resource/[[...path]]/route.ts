import { json } from '@/lib/http';
import { oauthEnabled } from '@/lib/oauth/config';
import { CORS_HEADERS, oauthDisabledResponse } from '@/lib/oauth/http';
import { protectedResourceMetadata } from '@/lib/oauth/metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path?: string[] }> };

/** RFC 9728 metadata at /.well-known/oauth-protected-resource and …/api/mcp (§2.1). Anything else is 404. */
async function served(context: Context): Promise<boolean> {
  if (!oauthEnabled()) return false;
  const { path } = await context.params;
  return !path || path.length === 0 || (path.length === 2 && path[0] === 'api' && path[1] === 'mcp');
}

export async function GET(_req: Request, context: Context) {
  if (!(await served(context))) return oauthDisabledResponse();
  return json(protectedResourceMetadata(), 200, { ...CORS_HEADERS, 'cache-control': 'public, max-age=3600' });
}

export async function OPTIONS(_req: Request, context: Context) {
  if (!(await served(context))) return oauthDisabledResponse();
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
