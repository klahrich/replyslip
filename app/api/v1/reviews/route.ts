import { z } from 'zod';
import { HUMAN_REVIEW_MESSAGE, requireHumanOwner } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { listReviews } from '@/lib/reviews';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Held review_first items in the owner's workspace (spec 16), oldest first. `?agent_id=&limit=`. Human only. */
export function GET(req: Request) {
  return handle(async () => {
    const user = await requireHumanOwner(req, HUMAN_REVIEW_MESSAGE);
    const url = new URL(req.url);
    const agentRaw = url.searchParams.get('agent_id');
    if (agentRaw !== null && !z.uuid().safeParse(agentRaw).success) {
      throw new HttpError(400, 'validation_error', 'agent_id must be an agent id.', { fields: { agent_id: 'Use an agent id.' } });
    }
    const agentId = agentRaw ?? undefined;
    const limitRaw = Number(url.searchParams.get('limit') ?? '50');
    const limit = Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 50;
    return json(await listReviews(user.workspace.id, { agentId, limit }), 200, { 'cache-control': 'private, no-store' });
  });
}
