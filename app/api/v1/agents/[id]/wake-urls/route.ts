import { handle, json, requireUuid } from '@/lib/http';
import { publicOrigin } from '@/lib/origin';
import { issueWakeUrl, listWakeUrls, requireWakeUrlOwner, serializeWakeUrl } from '@/lib/wake-urls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' };

/** The agent's wake URLs, newest first. Prefix only: the full URL is shown once, at issue or rotate. */
export function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params;
    const subject = await requireWakeUrlOwner(req, requireUuid(id, 'agent'), { issue: false });
    return json({ wake_urls: await listWakeUrls(subject) }, 200, NO_STORE);
  });
}

/** Issue the agent's wake URL. 409 wake_url_exists while one is active. */
export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params;
    const subject = await requireWakeUrlOwner(req, requireUuid(id, 'agent'), { issue: true });
    const { row, url } = await issueWakeUrl(subject, publicOrigin(req));
    return json({ wake_url: { ...serializeWakeUrl(row), url } }, 201, NO_STORE);
  });
}
