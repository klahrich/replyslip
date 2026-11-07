import { z } from 'zod';
import { requireExternalCaller } from '@/lib/external-guest';
import { handle, json, parseBody, readJson } from '@/lib/http';
import { getAgentCard } from '@/lib/sharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  to: z.string().min(1).max(200),
});

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

/** What this invite grants. POST so the address is not in the URL. */
export function POST(req: Request) {
  return handle(async () => {
    const caller = await requireExternalCaller(req);
    const body = parseBody(bodySchema, await readJson(req));
    return json({ card: await getAgentCard(caller, body.to) }, 200, headers);
  });
}
