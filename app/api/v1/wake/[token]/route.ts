import { handle } from '@/lib/http';
import { pollWakeUrl } from '@/lib/wake-urls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public wake URL poll (docs/api.md "Wake URL for external agents"): only {"id": "<opaque>"}, or 404. */
export function GET(req: Request, context: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const { token } = await context.params;
    return pollWakeUrl(req, token);
  });
}
