import { z } from 'zod';
import { authenticateAgentKey, serializeAgent } from '@/lib/agents';
import { MCP_HEADER_PLACEHOLDER, redeemNextSteps } from '@/lib/agent-docs';
import { INVITE_LABEL_MAX } from '@/lib/constants';
import { webhookAuthSchema } from '@/lib/delivery';
import { HttpError } from '@/lib/errors';
import { bearerToken, handle, json, parseBody, readJson } from '@/lib/http';
import { redeemInvite } from '@/lib/invites';
import { clientIp, requestOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  invite: z.string().min(1).max(200),
  name: z.string().optional(),
  description: z.string().max(2000).optional(),
  label: z.string().max(INVITE_LABEL_MAX).optional(),
  webhook: z
    .object({
      url: z.string().min(1).max(2000),
      auth: webhookAuthSchema,
    })
    .optional(),
});

export function POST(req: Request) {
  return handle(async () => {
    const body = parseBody(bodySchema, await readJson(req));
    const bearer = bearerToken(req);
    const rateKey = { ip: clientIp(req) };

    if (bearer) {
      const caller = bearer.startsWith('rsk_') ? await authenticateAgentKey(bearer) : null;
      if (!caller) throw new HttpError(401, 'unauthorized', 'Send an agent API key, or no Authorization header.');
      if (body.name !== undefined || body.description !== undefined || body.webhook !== undefined) {
        throw new HttpError(400, 'validation_error', 'name, description, and webhook are only for a new workspace.');
      }
      const result = await redeemInvite({ token: body.invite, label: body.label, target: { kind: 'existing', caller }, rateKey });
      if (result.kind !== 'existing') throw new HttpError(500, 'internal_error', 'Something went wrong.');
      return json({ share: result.share, created: result.created }, result.created ? 201 : 200);
    }

    if (body.name === undefined) throw new HttpError(400, 'validation_error', 'name is required.');
    const result = await redeemInvite({
      token: body.invite,
      label: body.label,
      target: {
        kind: 'new',
        name: body.name,
        description: body.description,
        delivery: body.webhook ? { mode: 'webhook', url: body.webhook.url, auth: body.webhook.auth } : undefined,
      },
      rateKey,
    });
    if (result.kind !== 'new') throw new HttpError(500, 'internal_error', 'Something went wrong.');
    const origin = requestOrigin(req);
    return json(
      {
        agent: serializeAgent(result.agent),
        api_key: result.apiKey,
        workspace: {
          id: result.workspace.id,
          handle: result.workspace.handle,
          claim_url: `${origin}/claim#${result.claimToken}`,
        },
        share: result.share,
        mcp: {
          url: `${origin}/api/mcp`,
          transport: 'http',
          header: MCP_HEADER_PLACEHOLDER,
        },
        docs: {
          llms: `${origin}/llms.txt`,
          getting_started: `${origin}/docs/getting-started.md`,
          skill: `${origin}/skill.md`,
          api: `${origin}/docs/api.md`,
        },
        next_steps: redeemNextSteps(result.share.address, result.share.status),
      },
      201,
    );
  });
}
