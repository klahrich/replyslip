import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { deleteOffer, updateOffer } from '@/lib/sharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  result_schema: z.record(z.string(), z.json()).optional(),
});

export function PATCH(req: Request, context: { params: Promise<{ id: string; offerId: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id, offerId } = await context.params;
    const body = parseBody(bodySchema, await readJson(req));
    const offer = await updateOffer(user.workspace.id, requireUuid(id, 'agent'), requireUuid(offerId, 'offer'), {
      name: body.name,
      description: body.description,
      resultSchema: body.result_schema,
    });
    return json({ offer });
  });
}

export function DELETE(req: Request, context: { params: Promise<{ id: string; offerId: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id, offerId } = await context.params;
    await deleteOffer(user.workspace.id, requireUuid(id, 'agent'), requireUuid(offerId, 'offer'));
    return json({ ok: true });
  });
}
