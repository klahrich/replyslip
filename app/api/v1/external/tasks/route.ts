import { z } from 'zod';
import { TASK_DESCRIPTION_MAX, TASK_TITLE_MAX } from '@/lib/constants';
import { requireExternalCaller } from '@/lib/external-guest';
import { handle, json, parseBody, readJson } from '@/lib/http';
import { createTask, listTasks, parseTaskCursor, parseUpdatedSince } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = new Set(['open', 'done', 'needs_info', 'failed', 'in_review', 'awaiting_release']);

const createSchema = z.object({
  to: z.string().min(1).max(200),
  offer: z.string().min(1).max(64),
  title: z.string().max(TASK_TITLE_MAX).optional(),
  description: z.string().max(TASK_DESCRIPTION_MAX).optional(),
  input: z.unknown().optional(),
});

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

export function GET(req: Request) {
  return handle(async () => {
    const caller = await requireExternalCaller(req);
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? undefined;
    if (status && !STATUSES.has(status)) {
      return json(
        { error: { code: 'validation_error', message: 'status must be open, done, needs_info, failed, in_review, or awaiting_release.' } },
        400,
        headers,
      );
    }
    const page = await listTasks(caller, {
      status,
      role: 'sent',
      updatedSince: parseUpdatedSince(url.searchParams.get('updated_since')),
      cursor: parseTaskCursor(url.searchParams.get('cursor')),
    });
    return json(page, 200, headers);
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const caller = await requireExternalCaller(req);
    const body = parseBody(createSchema, await readJson(req));
    const task = await createTask(caller, {
      to: body.to,
      offer: body.offer,
      title: body.title,
      description: body.description,
      input: body.input,
    });
    return json({ task }, 201, headers);
  });
}
