import { z } from 'zod';
import { REQUEST_CODE_MESSAGE, requestLoginCode } from '@/lib/auth';
import { handle, json, parseBody, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ email: z.string() });

export function POST(req: Request) {
  return handle(async () => {
    const body = parseBody(bodySchema, await readJson(req));
    await requestLoginCode(body.email, req);
    return json({ ok: true, message: REQUEST_CODE_MESSAGE });
  });
}
