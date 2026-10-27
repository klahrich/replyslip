import { z } from 'zod';
import { authenticateWatcherKey } from '@/lib/agents';
import { HttpError } from '@/lib/errors';
import { bearerToken, handle, json, parseBody, readJson } from '@/lib/http';
import { ackWakes } from '@/lib/wakes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  wake_ids: z.array(z.uuid()).max(50),
});

export function POST(req: Request) {
  return handle(async () => {
    const token = bearerToken(req);
    if (!token) throw new HttpError(401, 'unauthorized', 'Watcher key required.');
    const watcher = await authenticateWatcherKey(token);
    if (!watcher) throw new HttpError(401, 'unauthorized', 'Watcher key rejected. Check the key in your dashboard.');
    const body = parseBody(bodySchema, await readJson(req));
    const acked = await ackWakes(watcher.workspaceId, body.wake_ids);
    return json({ acked });
  });
}
