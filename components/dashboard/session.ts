import { cookies } from 'next/headers';
import { cache } from 'react';
import { sessionUser, type SessionUser } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/constants';

/**
 * Reads the session cookie and resolves the signed-in user with the backend's
 * own lookup (lib/auth). Returns null when there is no valid session.
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const req = new Request('http://replyslip.internal/', {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
  });
  return sessionUser(req);
});
