import { json } from '@/lib/http';
import { oauthEnabled } from '@/lib/oauth/config';
import { CORS_HEADERS, corsPreflight, oauthDisabledResponse } from '@/lib/oauth/http';
import { authorizationServerMetadata } from '@/lib/oauth/metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** RFC 8414 authorization server metadata (§2.3). */
export function GET() {
  if (!oauthEnabled()) return oauthDisabledResponse();
  return json(authorizationServerMetadata(), 200, { ...CORS_HEADERS, 'cache-control': 'public, max-age=3600' });
}

export function OPTIONS() {
  return corsPreflight();
}
