import { z } from 'zod';
import { authenticateAgentKey, serializeAgent } from '@/lib/agents';
import { inviteBearerNextSteps, MCP_HEADER_PLACEHOLDER, redeemNextSteps } from '@/lib/agent-docs';
import { EXTERNAL_GUEST_AGENT_NAME, INVITE_LABEL_MAX } from '@/lib/constants';
import { webhookAuthSchema } from '@/lib/delivery';
import { HttpError } from '@/lib/errors';
import { bearerToken, handle, json, parseBody, readJson } from '@/lib/http';
import { assertAgentGuestsEnabled, redeemInvite } from '@/lib/invites';
import { clientIp, publicOrigin } from '@/lib/origin';

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
    assertAgentGuestsEnabled();
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

    const named = body.name !== undefined;
    const result = await redeemInvite({
      token: body.invite,
      label: body.label,
      target: {
        kind: 'new',
        name: body.name ?? EXTERNAL_GUEST_AGENT_NAME,
        description: body.description,
        delivery: body.webhook ? { mode: 'webhook', url: body.webhook.url, auth: body.webhook.auth } : undefined,
        // Nameless redeem of a single-use link binds that link as the credential. A repeat is the same guest.
        bearerBind: !named,
      },
      rateKey,
    });
    const origin = publicOrigin(req);
    const docs = {
      llms: `${origin}/llms.txt`,
      getting_started: `${origin}/docs/getting-started.md`,
      skill: `${origin}/skill.md`,
      api: `${origin}/docs/api.md`,
    };
    if (result.kind === 'bound' || (result.kind === 'new' && result.credential === 'invite')) {
      // The invite token the caller already sent is the credential. Do not echo it, and do not mint a second secret.
      return json(
        {
          credential: 'invite',
          created: result.kind === 'new',
          share: result.share,
          mcp: {
            url: `${origin}/api/mcp`,
            transport: 'http',
            header: 'Bearer <invite token>',
          },
          http: { base: `${origin}/api/v1/external` },
          docs,
          next_steps: inviteBearerNextSteps(result.share.address, result.share.status),
        },
        result.kind === 'new' ? 201 : 200,
      );
    }
    if (result.kind !== 'new') throw new HttpError(500, 'internal_error', 'Something went wrong.');
    return json(
      {
        credential: 'guest_key',
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
        http: { base: `${origin}/api/v1/external` },
        docs,
        next_steps: redeemNextSteps(result.share.address, result.share.status),
      },
      201,
    );
  });
}
