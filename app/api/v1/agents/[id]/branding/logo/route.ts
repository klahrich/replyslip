import { requireHumanOwner } from '@/lib/auth';
import { deleteOwnerLogo, uploadOwnerLogo } from '@/lib/branding';
import { handle, json, readImageBody, requireUuid } from '@/lib/http';
import { assertSameOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Raw PNG, JPEG, or WebP body, at most 512 KB. Stored as a re-encoded WebP (spec 13.4). */
export function PUT(req: Request, context: Context) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    assertSameOrigin(req);
    const { id } = await context.params;
    const agentId = requireUuid(id, 'agent');
    return json(await uploadOwnerLogo(user.workspace.id, agentId, (max) => readImageBody(req, max)));
  });
}

export function DELETE(req: Request, context: Context) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    assertSameOrigin(req);
    const { id } = await context.params;
    return json(await deleteOwnerLogo(user.workspace.id, requireUuid(id, 'agent')));
  });
}
