import { getDemoShotRoute } from '@/lib/site-assistant/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The stored homepage screenshot (desktop or mobile) behind the demo chat. Never from public/ or a storage URL. */
export function GET(req: Request, context: { params: Promise<{ token: string; kind: string }> }) {
  return getDemoShotRoute(req, context);
}
