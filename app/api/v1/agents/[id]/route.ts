import { getAgent, renameAgent, serializeAgent, watcherPresence, workspaceWatcherLastSeen } from '@/lib/agents';
import { requireHumanOwner, requireUser } from '@/lib/auth';
import { z } from 'zod';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { oauthEnabled } from '@/lib/oauth/config';
import { oauthDisabledResponse } from '@/lib/oauth/http';
import { assertSameOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const agent = await getAgent(user.workspace.id, requireUuid(id, 'agent'));
    const seen = await workspaceWatcherLastSeen(user.workspace.id);
    return json({ agent: { ...serializeAgent(agent), ...watcherPresence(agent, seen) } });
  });
}

const renameSchema = z.object({ name: z.string().max(200) }).strict();

/** Rename (docs/design/mcp-oauth.md §6.6). Ships with MCP OAuth, so it is 404 until MCP_OAUTH_ENABLED=1. */
export function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    if (!oauthEnabled()) return oauthDisabledResponse();
    assertSameOrigin(req);
    const user = await requireHumanOwner(req, 'Agents are renamed by a signed-in human in the dashboard.');
    const { id } = await context.params;
    const agentId = requireUuid(id, 'agent');
    const body = parseBody(renameSchema, await readJson(req));
    const agent = await renameAgent(user.workspace.id, agentId, body.name.trim());
    const seen = await workspaceWatcherLastSeen(user.workspace.id);
    return json({ agent: { ...serializeAgent(agent), ...watcherPresence(agent, seen) } });
  });
}
