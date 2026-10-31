import { z } from 'zod';
import { requireHumanOwner } from '@/lib/auth';
import { deleteOwnerBranding, getOwnerBranding, updateOwnerBranding } from '@/lib/branding';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { assertSameOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Types are checked by the branding validators, so the error codes are invalid_display_name / invalid_color.
const bodySchema = z
  .object({
    display_name: z.unknown().optional(),
    primary_color: z.unknown().optional(),
    accent_color: z.unknown().optional(),
  })
  .strict();

type Context = { params: Promise<{ id: string }> };

/** Owner branding for a shared agent (spec 13.3). Session cookie, human only. */
export function GET(req: Request, context: Context) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    const { id } = await context.params;
    return json(await getOwnerBranding(user.workspace.id, requireUuid(id, 'agent')));
  });
}

/** `{ display_name?, primary_color?, accent_color? }`; null clears a field. */
export function PUT(req: Request, context: Context) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    assertSameOrigin(req);
    const { id } = await context.params;
    const agentId = requireUuid(id, 'agent');
    const body = parseBody(bodySchema, await readJson(req));
    return json(await updateOwnerBranding(user.workspace.id, agentId, body));
  });
}

/** Back to the defaults, logo included. */
export function DELETE(req: Request, context: Context) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    assertSameOrigin(req);
    const { id } = await context.params;
    return json(await deleteOwnerBranding(user.workspace.id, requireUuid(id, 'agent')));
  });
}
