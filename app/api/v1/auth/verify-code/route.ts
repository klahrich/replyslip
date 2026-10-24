import { z } from 'zod';
import { serializeUser, verifyLoginCode } from '@/lib/auth';
import { handle, json, parseBody, readJson, sessionCookie } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string(),
  code: z.string(),
});

export function POST(req: Request) {
  return handle(async () => {
    const body = parseBody(bodySchema, await readJson(req));
    const { token, user } = await verifyLoginCode(body.email, body.code);
    return json(serializeUser(user), 200, { 'set-cookie': sessionCookie(token) });
  });
}
