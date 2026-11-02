import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { agents, oauthClients, oauthGrants, users } from '@/db/schema';
import { HttpError } from '../errors';
import { clientDisplay } from './clients';
import { isElevatedScope, ownerScopeEnabled } from './config';
import { revokeGrant } from './grants';
import { redirectHost } from './redirect';
import { oauthNow } from './tokens';

/** §6.4 / §6.5: the dashboard's connected-apps list and Disconnect. Session cookie only (the routes check). */

export type ConnectedApp = {
  id: string;
  client: { display_name: string; client_name: string; verified: boolean; kind: 'cimd' | 'dcr' };
  redirect_host: string;
  agent: { id: string; name: string; revoked: boolean };
  /** Space-separated, as granted. Kept for older callers; prefer `scopes`. */
  scope: string;
  /** §5.10: the scopes the user granted, `agent` first, e.g. ["agent"] or ["agent", "agent:respond", "agent:owner"]. */
  scopes: string[];
  /** True when `scopes` holds a higher scope (agent:respond or agent:owner). Such a connection lasts 30 days by default. */
  elevated: boolean;
  /**
   * §5.10: true when `elevated` but MCP_OAUTH_OWNER_SCOPE is off right now, so the higher access is paused (the app
   * gets `agent` tools only; it comes back if the flag is turned on before `expires_at`). False otherwise.
   */
  elevated_paused: boolean;
  approved_by_email: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  /** Set once the connection ends by revoke (by the user, a reconnect, or a security revoke). */
  revoked_at: string | null;
  status: 'active' | 'revoked' | 'expired';
};

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

function selectRows(workspaceId: string, grantId?: string) {
  const now = oauthNow();
  const since = new Date(now.getTime() - RECENT_MS);
  const recent = or(
    and(isNull(oauthGrants.revokedAt), gt(oauthGrants.absoluteExpiresAt, since)),
    gt(oauthGrants.revokedAt, since),
  );
  return getDb()
    .select({ grant: oauthGrants, client: oauthClients, agent: agents, email: users.email })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .innerJoin(agents, eq(agents.id, oauthGrants.agentId))
    .innerJoin(users, eq(users.id, oauthGrants.userId))
    .where(and(eq(oauthGrants.workspaceId, workspaceId), grantId ? eq(oauthGrants.id, grantId) : recent))
    .orderBy(desc(oauthGrants.createdAt));
}

type Row = Awaited<ReturnType<typeof selectRows>>[number];

function serialize(row: Row): ConnectedApp {
  const { grant, client, agent } = row;
  const display = clientDisplay(client);
  const now = oauthNow().getTime();
  return {
    id: grant.id,
    client: { display_name: display.display_name, client_name: display.client_name, verified: display.verified, kind: display.kind },
    redirect_host: redirectHost(grant.redirectUri),
    agent: { id: agent.id, name: agent.name, revoked: agent.revokedAt !== null },
    scope: grant.scope,
    scopes: grant.scope.split(' ').filter(Boolean),
    elevated: grant.scope.split(' ').some(isElevatedScope),
    elevated_paused: grant.scope.split(' ').some(isElevatedScope) && !ownerScopeEnabled(),
    approved_by_email: row.email,
    created_at: grant.createdAt.toISOString(),
    last_used_at: grant.lastUsedAt?.toISOString() ?? null,
    expires_at: grant.absoluteExpiresAt.toISOString(),
    revoked_at: grant.revokedAt?.toISOString() ?? null,
    status: grant.revokedAt ? 'revoked' : grant.absoluteExpiresAt.getTime() <= now ? 'expired' : 'active',
  };
}

/** The workspace's grants, newest first: active ones plus those revoked or expired in the last 30 days. */
export async function listConnectedApps(workspaceId: string): Promise<ConnectedApp[]> {
  return (await selectRows(workspaceId)).map(serialize);
}

/** Disconnect (reason `user`). Idempotent; the agent stays. 404 for a grant outside the workspace. */
export async function disconnectApp(workspaceId: string, grantId: string): Promise<ConnectedApp> {
  const [row] = await selectRows(workspaceId, grantId);
  if (!row) throw new HttpError(404, 'not_found', 'No connected app was found.');
  await revokeGrant(getDb(), row.grant.id, 'user');
  const [fresh] = await selectRows(workspaceId, grantId);
  return serialize(fresh ?? row);
}
