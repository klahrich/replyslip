import { getDemoRoute } from '@/lib/site-assistant/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The demo page's one load: business (name, status, tile), banner, checked suggested questions, and this
 * visitor's messages (visitor cookie). The token in the path picks the business; nothing else can.
 */
export function GET(req: Request, context: { params: Promise<{ token: string }> }) {
  return getDemoRoute(req, context);
}
