import { z } from 'zod';
import { issueWatcherKey, listWatcherKeys } from '@/lib/agents';
import { requireUser } from '@/lib/auth';
import { handle, json, parseBody, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ name: z.string() });

export function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    return json({ watcher_keys: await listWatcherKeys(user.workspace.id) });
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const body = parseBody(bodySchema, await readJson(req));
    const { key, secret } = await issueWatcherKey(user.workspace.id, body.name);
    return json(
      {
        watcher_key: {
          id: key.id,
          name: key.name,
          prefix: key.tokenPrefix,
          created_at: key.createdAt.toISOString(),
          secret,
        },
      },
      201,
    );
  });
}
