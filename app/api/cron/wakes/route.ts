import { handle, json } from '@/lib/http';
import { assertCronAuthorized, dispatchDueWebhookWakes } from '@/lib/wakes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function run(req: Request) {
  return handle(async () => {
    assertCronAuthorized(req);
    const result = await dispatchDueWebhookWakes();
    return json({ ok: true, ...result });
  });
}

export function GET(req: Request) {
  return run(req);
}

export function POST(req: Request) {
  return run(req);
}
