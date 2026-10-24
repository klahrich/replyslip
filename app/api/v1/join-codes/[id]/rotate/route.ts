import { rotateJoinCode, serializeJoinCode } from '@/lib/agents';
import { requireUser } from '@/lib/auth';
import { handle, json, requireUuid } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const { code, secret } = await rotateJoinCode(user, requireUuid(id, 'join code'));
    return json({ join_code: { ...serializeJoinCode(code), secret } }, 201);
  });
}
