import { HUMAN_REVIEW_MESSAGE, requireHumanOwner } from '@/lib/auth';
import { handle, json, requireUuid } from '@/lib/http';
import { getReview } from '@/lib/reviews';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One review_first item for the single review page (spec 17.12). Human only. */
export function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireHumanOwner(req, HUMAN_REVIEW_MESSAGE);
    const { id } = await context.params;
    return json(await getReview(user.workspace.id, requireUuid(id, 'task')), 200, { 'cache-control': 'private, no-store' });
  });
}
