import { handle } from '@/lib/http';
import { unsubscribePage, unsubscribeWithToken } from '@/lib/marketing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function respond(req: Request) {
  return handle(async () => {
    const token = new URL(req.url).searchParams.get('token') ?? '';
    return unsubscribePage(await unsubscribeWithToken(token));
  });
}

export function GET(req: Request) {
  return respond(req);
}

export function POST(req: Request) {
  return respond(req);
}
