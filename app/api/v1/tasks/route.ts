import { requireUser } from '@/lib/auth';
import { handle, json } from '@/lib/http';
import { listWorkspaceTasks, parseTaskCursor, parseUpdatedSince } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = new Set(['open', 'done', 'needs_info', 'failed', 'in_review', 'awaiting_release']);

export function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? undefined;
    if (status && !STATUSES.has(status)) {
      return json(
        { error: { code: 'validation_error', message: 'status must be open, done, needs_info, failed, in_review, or awaiting_release.' } },
        400,
      );
    }
    const limitRaw = Number(url.searchParams.get('limit') ?? '50');
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 50;
    const page = {
      updatedSince: parseUpdatedSince(url.searchParams.get('updated_since')),
      cursor: parseTaskCursor(url.searchParams.get('cursor')),
    };
    const { tasks, next_cursor } = await listWorkspaceTasks(user.workspace.id, status, limit, page);
    return json({ tasks, next_cursor });
  });
}
