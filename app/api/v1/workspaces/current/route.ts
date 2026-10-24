import { z } from 'zod';
import { renameWorkspace, requireUser } from '@/lib/auth';
import { handle, json, parseBody, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ name: z.string() });

export function PATCH(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const body = parseBody(bodySchema, await readJson(req));
    const workspace = await renameWorkspace(user.workspace.id, body.name);
    return json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        created_at: workspace.createdAt.toISOString(),
      },
    });
  });
}
