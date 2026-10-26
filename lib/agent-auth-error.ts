/** Descriptions for a rejected agent credential. None of these include the token. */

export const AGENT_AUTH_MISSING =
  "No authorization provided. Send 'Authorization: Bearer <agent key>'; agent keys start with rsk_.";

export const AGENT_AUTH_NOT_BEARER =
  'Authorization must use the Bearer scheme with your agent key (starts with rsk_).';

export const AGENT_AUTH_WATCHER_KEY =
  "This is a watcher key (rsw_). MCP needs this agent's own key (starts with rsk_). Watcher keys only work with replyslip watch.";

export const AGENT_AUTH_REVOKED =
  "This agent key was revoked. Ask the human for a new join code and register again, or use the agent's current key.";

export const AGENT_AUTH_REVOKED_WATCHER =
  'This watcher key was revoked. Create a new one under Watchers on the dashboard.';

export const AGENT_AUTH_UNKNOWN =
  'Unknown agent key. Agent keys start with rsk_. Check ~/.replyslip/agents/<name>.json.';

export type StoredCredential = {
  agentKeyRevoked: boolean;
  watcherKeyRevoked: boolean;
};

export type AgentAuthFailure = 'missing' | 'not_bearer' | 'watcher_key' | 'revoked' | 'revoked_watcher' | 'unknown';

/**
 * Classify a raw Authorization header the same way mcp-handler does:
 * the scheme is the first space-separated field and the token is the second.
 * Revoked rows are supplied by a hash lookup. A live watcher key is recognized
 * only by the rsw_ prefix. The token is not returned.
 */
export function agentAuthFailure(authorization: string | null | undefined, stored?: StoredCredential | null): AgentAuthFailure {
  if (authorization == null) return 'missing';
  const [scheme, token] = authorization.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return 'not_bearer';
  if (stored?.agentKeyRevoked) return 'revoked';
  if (stored?.watcherKeyRevoked) return 'revoked_watcher';
  if (token.startsWith('rsw_')) return 'watcher_key';
  return 'unknown';
}

export function agentAuthErrorDescription(authorization: string | null | undefined, stored?: StoredCredential | null): string {
  switch (agentAuthFailure(authorization, stored)) {
    case 'missing':
      return AGENT_AUTH_MISSING;
    case 'not_bearer':
      return AGENT_AUTH_NOT_BEARER;
    case 'watcher_key':
      return AGENT_AUTH_WATCHER_KEY;
    case 'revoked':
      return AGENT_AUTH_REVOKED;
    case 'revoked_watcher':
      return AGENT_AUTH_REVOKED_WATCHER;
    case 'unknown':
      return AGENT_AUTH_UNKNOWN;
  }
}

/** Replace error_description in a Bearer challenge and leave the other parameters in place. */
export function replaceWwwAuthenticateDescription(header: string, description: string): string {
  const escaped = description.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll(/[^\u0020-\u007E]/g, ' ');
  if (!/error_description="(?:\\.|[^"\\])*"/.test(header)) return header;
  return header.replace(/error_description="(?:\\.|[^"\\])*"/, `error_description="${escaped}"`);
}
