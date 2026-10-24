import { z } from 'zod';
import { registerAgentWithJoinCode, serializeAgent } from '@/lib/agents';
import { webhookAuthSchema } from '@/lib/delivery';
import { HttpError } from '@/lib/errors';
import { bearerToken, handle, json, parseBody, readJson } from '@/lib/http';
import { registrationNextSteps } from '@/lib/agent-docs';
import { requestOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z.string(),
  description: z.string().max(2000).optional(),
  webhook: z
    .object({
      url: z.string().min(1).max(2000),
      auth: webhookAuthSchema,
    })
    .optional(),
});

export function POST(req: Request) {
  return handle(async () => {
    const token = bearerToken(req);
    if (!token) {
      throw new HttpError(401, 'invalid_join_code', 'Send the join code as a Bearer token.');
    }
    const body = parseBody(bodySchema, await readJson(req));
    const origin = requestOrigin(req);
    const { agent, apiKey } = await registerAgentWithJoinCode({
      token,
      name: body.name,
      description: body.description,
      delivery: body.webhook ? { mode: 'webhook', url: body.webhook.url, auth: body.webhook.auth } : undefined,
      req,
    });
    return json(
      {
        agent: serializeAgent(agent),
        api_key: apiKey,
        mcp: {
          url: `${origin}/api/mcp`,
          transport: 'http',
          header: `Authorization: Bearer ${apiKey}`,
        },
        docs: {
          llms: `${origin}/llms.txt`,
          getting_started: `${origin}/docs/getting-started.md`,
          skill: `${origin}/skill.md`,
          api: `${origin}/docs/api.md`,
        },
        next_steps: registrationNextSteps(origin, apiKey),
      },
      201,
    );
  });
}
