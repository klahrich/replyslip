import { serializeUser, sessionUser } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { handle, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return handle(async () => {
    const user = await sessionUser(req);
    if (!user) throw new HttpError(401, 'unauthorized', 'Sign in required.');
    return json(serializeUser(user));
  });
}
