import { authenticateWatcherKey, recordWatcherSeen } from '@/lib/agents';
import { HttpError } from '@/lib/errors';
import { bearerToken, handle, json } from '@/lib/http';
import { leaseHerdrWakes } from '@/lib/wakes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return handle(async () => {
    const token = bearerToken(req);
    if (!token) throw new HttpError(401, 'unauthorized', 'Watcher key required.');
    const watcher = await authenticateWatcherKey(token);
    if (!watcher) throw new HttpError(401, 'unauthorized', 'Watcher key required.');
    await recordWatcherSeen(watcher.keyId);
    const wakes = await leaseHerdrWakes(watcher.workspaceId);
    return json({ wakes });
  });
}
