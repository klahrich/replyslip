import { z } from 'zod';
import { serializeUser, verifyLoginCode } from '@/lib/auth';
import { handle, json, parseBody, readJson, sessionCookie } from '@/lib/http';
import { consentTextForOptIn } from '@/lib/marketing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string(),
  code: z.string(),
  marketing_opt_in: z.boolean().optional(),
  consent_text: z.string().optional(),
});

export function POST(req: Request) {
  return handle(async () => {
    const body = parseBody(bodySchema, await readJson(req));
    const marketing = body.marketing_opt_in
      ? { consentText: consentTextForOptIn(body.consent_text) }
      : undefined;
    const { token, user } = await verifyLoginCode(body.email, body.code, marketing);
    return json(serializeUser(user), 200, { 'set-cookie': sessionCookie(token) });
  });
}
