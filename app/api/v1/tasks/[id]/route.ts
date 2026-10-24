import { requireUser } from '@/lib/auth';
import { handle, json, requireUuid } from '@/lib/http';
import { getWorkspaceTask } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    return json(await getWorkspaceTask(user.workspace.id, requireUuid(id, 'task')));
  });
}
