import { serializeUser, sessionUser } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { workspacePlanUsage } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return handle(async () => {
    const user = await sessionUser(req);
    if (!user) throw new HttpError(401, 'unauthorized', 'Sign in required.');
    const body = serializeUser(user);
    if (user.workspace && body.workspace) {
      const plan = await workspacePlanUsage(user.workspace.id);
      return json({ ...body, workspace: { ...body.workspace, ...plan } });
    }
    return json(body);
  });
}
