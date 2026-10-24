import { z } from 'zod';
import { serializeUser, sessionUser, type SessionUser } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { handle, json, parseBody, readJson } from '@/lib/http';
import { setMarketingOptIn } from '@/lib/marketing';
import { workspacePlanUsage } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  marketing_opt_in: z.boolean(),
  consent_text: z.string().optional(),
});

async function sessionResponse(user: SessionUser) {
  const body = serializeUser(user);
  if (user.workspace && body.workspace) {
    const plan = await workspacePlanUsage(user.workspace.id);
    return { ...body, workspace: { ...body.workspace, ...plan } };
  }
  return body;
}

export function GET(req: Request) {
  return handle(async () => {
    const user = await sessionUser(req);
    if (!user) throw new HttpError(401, 'unauthorized', 'Sign in required.');
    return json(await sessionResponse(user));
  });
}

export function PATCH(req: Request) {
  return handle(async () => {
    const user = await sessionUser(req);
    if (!user) throw new HttpError(401, 'unauthorized', 'Sign in required.');
    const body = parseBody(patchSchema, await readJson(req));
    await setMarketingOptIn(user.id, body.marketing_opt_in, body.consent_text);
    const fresh = await sessionUser(req);
    if (!fresh) throw new HttpError(401, 'unauthorized', 'Sign in required.');
    return json(await sessionResponse(fresh));
  });
}
