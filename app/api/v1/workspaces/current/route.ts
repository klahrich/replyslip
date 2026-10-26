import { z } from 'zod';
import { renameWorkspace, requireUser } from '@/lib/auth';
import { handle, json, parseBody, readJson } from '@/lib/http';
import { publicWorkspace, setWorkspaceHandle } from '@/lib/sharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    name: z.string().optional(),
    handle: z.string().nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.handle !== undefined, {
    message: 'Send a name, a handle, or both.',
  });

export function PATCH(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const body = parseBody(bodySchema, await readJson(req));
    let workspace = {
      id: user.workspace.id,
      name: user.workspace.name,
      handle: user.workspace.handle,
      createdAt: user.workspace.createdAt,
    };
    if (body.name !== undefined) {
      const renamed = await renameWorkspace(user.workspace.id, body.name);
      workspace = { ...workspace, ...renamed };
    }
    if (body.handle !== undefined) {
      const updated = await setWorkspaceHandle(user.workspace.id, body.handle);
      return json({ workspace: updated });
    }
    return json({ workspace: publicWorkspace(workspace) });
  });
}
