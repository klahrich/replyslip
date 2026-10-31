import { z } from 'zod';
import { HUMAN_REVIEW_MESSAGE, requireHumanOwner } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { handle, json, parseBody, readOptionalJson, requireUuid } from '@/lib/http';
import { assertSameOrigin } from '@/lib/origin';
import { actOnReview, type ReviewAction } from '@/lib/reviews';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS: Record<string, ReviewAction> = {
  approve: 'approve',
  decline: 'decline',
  release: 'release',
  'send-back': 'send_back',
};

const bodySchema = z.object({ note: z.string().max(10_000).optional() }).strict();

/**
 * POST /api/v1/reviews/:id/{approve,decline,release,send-back}. Session cookie, human only, same Origin.
 * Body: none, or `{ note }` (required for send-back, optional for decline, not allowed otherwise).
 */
export function POST(req: Request, context: { params: Promise<{ id: string; action: string }> }) {
  return handle(async () => {
    const user = await requireHumanOwner(req, HUMAN_REVIEW_MESSAGE);
    assertSameOrigin(req);
    const { id, action } = await context.params;
    const kind = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
    if (!kind) throw new HttpError(404, 'not_found', 'Use approve, decline, release, or send-back.');
    const taskId = requireUuid(id, 'task');
    const body = parseBody(bodySchema, await readOptionalJson(req));
    return json(await actOnReview({ userId: user.id, workspaceId: user.workspace.id }, taskId, kind, body));
  });
}
