import { HttpError } from '@/lib/errors';
import { bearerToken, handle, json } from '@/lib/http';
import { assertAgentGuestsEnabled, previewInvite } from '@/lib/invites';
import { clientIp } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return handle(async () => {
    assertAgentGuestsEnabled();
    const token = bearerToken(req);
    if (!token?.startsWith('rsi_')) {
      throw new HttpError(404, 'invite_not_found', 'No invite matches that token.');
    }
    const preview = await previewInvite(token, { ip: clientIp(req) });
    return json(preview, 200, { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  });
}
