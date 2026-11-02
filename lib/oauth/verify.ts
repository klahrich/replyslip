import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { agents, oauthAccessTokens, oauthClients, oauthGrants, users } from '@/db/schema';
import type { AgentPrincipal } from '../agents';
import { OAUTH_LAST_USED_THROTTLE_MS } from './constants';
import { sha256 } from '../crypto';
import { effectiveScopes, oauthResource } from './config';
import { revokeGrant } from './grants';
import { hasPrefix, oauthNow } from './tokens';

export type OAuthPrincipal = AgentPrincipal & {
  grantId: string;
  /** The OAuth client_id string (a CIMD URL or rsdc_…). */
  clientId: string;
  /** Epoch seconds. */
  expiresAt: number;
  scopes: string[];
};

/**
 * §4: an rsoa_ token becomes the same principal an rsk_ key does. One query joins token, grant, agent, approving user
 * and client; every condition must hold. Never throws with the token in the message.
 */
export async function authenticateOAuthAccessToken(token: string): Promise<OAuthPrincipal | null> {
  if (!hasPrefix(token, 'access')) return null;
  const db = getDb();
  const now = oauthNow();
  const [row] = await db
    .select({
      grantId: oauthGrants.id,
      grantUserId: oauthGrants.userId,
      workspaceId: oauthGrants.workspaceId,
      agentId: agents.id,
      agentName: agents.name,
      scope: oauthGrants.scope,
      lastUsedAt: oauthGrants.lastUsedAt,
      accessExpiresAt: oauthAccessTokens.expiresAt,
      userWorkspaceId: users.workspaceId,
      clientId: oauthClients.clientId,
    })
    .from(oauthAccessTokens)
    .innerJoin(oauthGrants, eq(oauthGrants.id, oauthAccessTokens.grantId))
    .innerJoin(agents, eq(agents.id, oauthGrants.agentId))
    .innerJoin(users, eq(users.id, oauthGrants.userId))
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(
      and(
        eq(oauthAccessTokens.tokenHash, sha256(token)),
        isNull(oauthAccessTokens.revokedAt),
        gt(oauthAccessTokens.expiresAt, now),
        isNull(oauthGrants.revokedAt),
        gt(oauthGrants.absoluteExpiresAt, now),
        eq(oauthGrants.resource, oauthResource()),
        isNull(agents.revokedAt),
        eq(agents.role, 'agent'),
        eq(agents.workspaceId, oauthGrants.workspaceId),
        isNull(oauthClients.disabledAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.userWorkspaceId !== row.workspaceId) {
    // The approver left the workspace: access stops now, and the grant is revoked lazily (§5.8).
    await revokeGrant(db, row.grantId, 'user_left_workspace');
    return null;
  }
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= OAUTH_LAST_USED_THROTTLE_MS) {
    await db.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, row.grantId));
  }
  return {
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    agentName: row.agentName,
    keyId: `oauth:${row.grantId}`,
    grantId: row.grantId,
    clientId: row.clientId,
    expiresAt: Math.floor(row.accessExpiresAt.getTime() / 1000),
    // §5.10: while MCP_OAUTH_OWNER_SCOPE is off, higher scopes on an older grant are ignored (fail closed).
    scopes: effectiveScopes(row.scope),
  };
}
