import { z } from 'zod';
import { createJoinCode, listJoinCodes, serializeJoinCode } from '@/lib/agents';
import { requireUser } from '@/lib/auth';
import { handle, json, parseBody, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  expires_in_hours: z.number().int().min(1).max(168).optional(),
});

export function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    return json({ join_codes: await listJoinCodes(user.workspace.id) });
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const contentType = req.headers.get('content-type') ?? '';
    const raw = contentType.toLowerCase().includes('application/json') ? await readJson(req) : {};
    const body = parseBody(bodySchema, raw);
    const { code, secret } = await createJoinCode(user, body.expires_in_hours);
    return json({ join_code: { ...serializeJoinCode(code), secret } }, 201);
  });
}
