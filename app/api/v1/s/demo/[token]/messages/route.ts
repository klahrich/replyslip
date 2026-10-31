import { postDemoMessageRoute } from '@/lib/site-assistant/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** One visitor question (or a tapped suggested question) in, one checked reply out. JSON, no streaming. */
export function POST(req: Request, context: { params: Promise<{ token: string }> }) {
  return postDemoMessageRoute(req, context);
}
