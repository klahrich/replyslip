import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { createOffer, listOffers } from '@/lib/sharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z.string(),
  // Readable job title for customers; null or "" clears it. Any type is passed through so normalizeOfferTitle answers invalid_offer_title.
  title: z.unknown().optional(),
  description: z.string(),
  result_schema: z.record(z.string(), z.json()),
  input_schema: z.record(z.string(), z.json()).nullable().optional(),
  notes_enabled: z.boolean().optional(),
});

export function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const offers = await listOffers(user.workspace.id, requireUuid(id, 'agent'));
    return json({ offers });
  });
}

export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const body = parseBody(bodySchema, await readJson(req));
    const offer = await createOffer(user.workspace.id, requireUuid(id, 'agent'), {
      name: body.name,
      title: body.title,
      description: body.description,
      resultSchema: body.result_schema,
      inputSchema: body.input_schema,
      notesEnabled: body.notes_enabled,
    });
    return json({ offer }, 201);
  });
}
