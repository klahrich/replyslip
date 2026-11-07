import { requireExternalCaller } from '@/lib/external-guest';
import { handle, json, requireUuid } from '@/lib/http';
import { getTask } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

export function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const caller = await requireExternalCaller(req);
    const { id } = await context.params;
    return json(await getTask(caller, requireUuid(id, 'task')), 200, headers);
  });
}
