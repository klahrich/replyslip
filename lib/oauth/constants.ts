/** MCP OAuth constants (docs/design/mcp-oauth.md). Kept out of lib/constants.ts so the CLI bundle does not change. */

/** Rate limits (§2, §5.2), merged into lib/rate-limit.ts. Only reachable when MCP_OAUTH_ENABLED=1. */
export const OAUTH_RATE_LIMITS = {
  oauthAuthorize: { ip: 60, windowMs: 15 * 60 * 1000 },
  /** Generous: ChatGPT and Claude call /token from a few shared egress IPs. */
  oauthToken: { ip: 1200, windowMs: 15 * 60 * 1000 },
  /** Refreshes per grant (the grant id is stored where agent ids go). */
  oauthRefresh: { agent: 60, windowMs: 15 * 60 * 1000 },
  oauthRevoke: { ip: 60, windowMs: 15 * 60 * 1000 },
  /** Consent decisions, keyed by the signed-in user id. */
  oauthConsent: { agent: 30, windowMs: 15 * 60 * 1000 },
  /** DCR (MCP_OAUTH_DCR, PR 3). Per IP; OpenAI registers from shared egress. */
  oauthRegister: { ip: 20, windowMs: 15 * 60 * 1000 },
} as const;

/** Lifetimes (docs/design/mcp-oauth.md §3). */
export const OAUTH_REQUEST_TTL_MS = 20 * 60 * 1000;
export const OAUTH_CODE_TTL_MS = 5 * 60 * 1000;
export const OAUTH_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const OAUTH_REFRESH_IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Decided: a connection lasts at most 365 days, then the user re-approves. */
export const OAUTH_GRANT_MAX_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** A rotated refresh token presented again within this window, while its replacement is unused, is a race, not reuse. */
export const OAUTH_REFRESH_RACE_WINDOW_MS = 2_000;
/** grants.last_used_at is written at most this often. */
export const OAUTH_LAST_USED_THROTTLE_MS = 5 * 60 * 1000;
export const OAUTH_CIMD_MIN_CACHE_MS = 5 * 60 * 1000;
export const OAUTH_CIMD_MAX_CACHE_MS = 24 * 60 * 60 * 1000;
/** A failed CIMD refetch keeps using a cached document younger than this. */
export const OAUTH_CIMD_STALE_OK_MS = 7 * 24 * 60 * 60 * 1000;
export const OAUTH_CIMD_TIMEOUT_MS = 5_000;
export const OAUTH_CIMD_MAX_BYTES = 8 * 1024;
export const OAUTH_DCR_UNUSED_TTL_MS = 24 * 60 * 60 * 1000;
export const OAUTH_DCR_IDLE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/**
 * DCR clients that pruneOAuth never deletes, by public client_id (oauth_clients.client_id, not the row's uuid).
 * Client ids are public identifiers, not secrets.
 */
export const OAUTH_PINNED_CLIENT_IDS: readonly string[] = [
  // Meta Muse, shared by all users, documented (lib/agent-docs.ts "Connecting Meta Muse").
  'rsdc_PST7_7QNatbPNN6qJ--EegkSjh3MiCVtNf7zJa3Tqp8',
];
/** DCR abuse limits (§5.2): new clients per rolling 24 h across all IPs, body size, list and field lengths. */
export const OAUTH_DCR_GLOBAL_DAILY = 500;
export const OAUTH_DCR_MAX_BODY_BYTES = 8 * 1024;
export const OAUTH_DCR_MAX_REDIRECT_URIS = 5;
export const OAUTH_DCR_MAX_URI_LENGTH = 2000;
export const OAUTH_DCR_MAX_NAME_INPUT = 500;
/** Shown when a DCR client sends no usable name, or one that impersonates a known app. */
export const OAUTH_DCR_FALLBACK_NAME = 'Unnamed app';
export const OAUTH_STATE_MAX_BYTES = 1024;
export const OAUTH_CLIENT_NAME_MAX = 100;
/** Pending flows one browser can hold in the __Host-valetto_oauth cookie. */
export const OAUTH_BINDING_COOKIE_MAX = 5;
export const OAUTH_BINDING_COOKIE = '__Host-valetto_oauth';
