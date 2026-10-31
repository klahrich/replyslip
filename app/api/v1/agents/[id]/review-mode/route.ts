import { z } from 'zod';
import { HUMAN_REVIEW_MESSAGE, requireHumanOwner } from '@/lib/auth';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { assertSameOrigin } from '@/lib/origin';
import { getReviewSettings, setReviewSettings } from '@/lib/reviews';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    review_mode: z.enum(['auto', 'review_first']).optional(),
    notify_review_email: z.boolean().optional(),
  })
  .strict();

type Context = { params: Promise<{ id: string }> };

/** Review-first setting for one bot (spec 16). Session cookie, human only. */
export function GET(req: Request, context: Context) {
  return handle(async () => {
    const user = await requireHumanOwner(req, HUMAN_REVIEW_MESSAGE);
    const { id } = await context.params;
    return json({ review: await getReviewSettings(user.workspace.id, requireUuid(id, 'agent')) });
  });
}

/** `{ review_mode?: 'auto' | 'review_first', notify_review_email?: boolean }`. Affects only new tasks. */
export function PUT(req: Request, context: Context) {
  return handle(async () => {
    const user = await requireHumanOwner(req, HUMAN_REVIEW_MESSAGE);
    assertSameOrigin(req);
    const { id } = await context.params;
    const agentId = requireUuid(id, 'agent');
    const body = parseBody(bodySchema, await readJson(req));
    const review = await setReviewSettings({ userId: user.id, workspaceId: user.workspace.id }, agentId, {
      reviewMode: body.review_mode,
      notifyReviewEmail: body.notify_review_email,
    });
    return json({ review });
  });
}
