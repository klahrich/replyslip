import { logoutSession } from '@/lib/auth';
import { clearSessionCookie, handle, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return handle(async () => {
    await logoutSession(req);
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
  });
}
