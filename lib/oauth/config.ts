import { isProductionDeployment } from '../origin';
import { isForbiddenScheme, type SchemePolicy } from './redirect';

/**
 * MCP OAuth configuration (docs/design/mcp-oauth.md §2). Every value is read on each call, so tests and deploys can
 * flip the flags. Nothing here derives a URL from Host or X-Forwarded-Host.
 */

/** Production issuer. Used for the /api/mcp challenge when MCP_OAUTH_ISSUER is unset. */
export const DEFAULT_ISSUER = 'https://valetto.tech';
export const DEFAULT_CIMD_HOSTS = ['chatgpt.com', 'claude.ai'];
export const OAUTH_SCOPE = 'agent';
/**
 * The higher scopes (§5.10). An rsk_ key always holds them. An OAuth app gets them only while MCP_OAUTH_OWNER_SCOPE=1,
 * only when it asks, and only when the user opts in on the consent page.
 */
export const SCOPE_RESPOND = 'agent:respond';
export const SCOPE_OWNER = 'agent:owner';
export const RSK_SCOPES = [OAUTH_SCOPE, SCOPE_RESPOND, SCOPE_OWNER];
/** The extra OAuth scopes above `agent`, in canonical order. */
export const ELEVATED_SCOPES = [SCOPE_RESPOND, SCOPE_OWNER] as const;
export type ElevatedScope = (typeof ELEVATED_SCOPES)[number];
/** Default for MCP_OAUTH_OWNER_MAX_DAYS: how long a connection holding a higher scope lasts before re-approval. */
export const OWNER_GRANT_DEFAULT_DAYS = 30;

export class OAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthConfigError';
  }
}

/** The whole OAuth surface. Off unless MCP_OAUTH_ENABLED=1: every OAuth route is 404 and /api/mcp keeps rsk_ only. */
export function oauthEnabled(): boolean {
  return process.env.MCP_OAUTH_ENABLED?.trim() === '1';
}

/** Higher OAuth scopes (§5.10). Off unless MCP_OAUTH_OWNER_SCOPE=1: never offered or granted, asks fall back to agent. */
export function ownerScopeEnabled(): boolean {
  return oauthEnabled() && process.env.MCP_OAUTH_OWNER_SCOPE?.trim() === '1';
}

/** The scopes an OAuth app can hold right now: `agent`, plus the higher ones while the flag is on. Advertised as-is. */
export function oauthScopesSupported(): string[] {
  return ownerScopeEnabled() ? [OAUTH_SCOPE, ...ELEVATED_SCOPES] : [OAUTH_SCOPE];
}

export function isElevatedScope(scope: string): scope is ElevatedScope {
  return (ELEVATED_SCOPES as readonly string[]).includes(scope);
}

/**
 * Lifetime of a connection that holds a higher scope: MCP_OAUTH_OWNER_MAX_DAYS whole days (1 to 365), default 30.
 * Anything else falls back to the default. Refresh tokens never outlive the connection.
 */
export function ownerGrantMaxDays(): number {
  const raw = process.env.MCP_OAUTH_OWNER_MAX_DAYS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return OWNER_GRANT_DEFAULT_DAYS;
  const days = Number(raw);
  return days >= 1 && days <= 365 ? days : OWNER_GRANT_DEFAULT_DAYS;
}

/** DCR (RFC 7591). Off unless MCP_OAUTH_DCR=1, and only meaningful with MCP_OAUTH_ENABLED=1. */
export function dcrEnabled(): boolean {
  return oauthEnabled() && process.env.MCP_OAUTH_DCR?.trim() === '1';
}

function canonicalIssuer(raw: string): string {
  let origin: string;
  try {
    origin = new URL(raw).origin;
  } catch {
    origin = 'null';
  }
  if (origin === 'null' || origin !== raw) {
    throw new OAuthConfigError(
      `MCP_OAUTH_ISSUER "${raw}" is not a canonical origin; write it as scheme://host[:port] with no path or trailing slash.`,
    );
  }
  if (!raw.startsWith('https://') && isProductionDeployment()) {
    throw new OAuthConfigError('MCP_OAUTH_ISSUER must be https in production.');
  }
  return raw;
}

/**
 * The fixed issuer, e.g. https://valetto.tech. With the flag on it must be set and canonical (in production a missing
 * value throws). With the flag off it falls back to DEFAULT_ISSUER, which only feeds the 401 challenge's
 * resource_metadata URL.
 */
export function oauthIssuer(): string {
  const raw = process.env.MCP_OAUTH_ISSUER?.trim();
  if (!raw) {
    if (oauthEnabled() && isProductionDeployment()) {
      throw new OAuthConfigError('MCP_OAUTH_ENABLED=1 needs MCP_OAUTH_ISSUER (e.g. https://valetto.tech).');
    }
    return DEFAULT_ISSUER;
  }
  if (!oauthEnabled()) {
    // Flag off: a bad value must not break the rsk_ challenge. validateOAuthConfig reports it once the flag is on.
    try {
      return canonicalIssuer(raw);
    } catch {
      return DEFAULT_ISSUER;
    }
  }
  return canonicalIssuer(raw);
}

/** The one protected resource: ${ISSUER}/api/mcp. */
export function oauthResource(): string {
  return `${oauthIssuer()}/api/mcp`;
}

export function absoluteIssuerUrl(path: string): string {
  return `${oauthIssuer()}${path}`;
}

/** Hosts whose CIMD documents we accept (MCP_OAUTH_CIMD_HOSTS, comma-separated; default chatgpt.com,claude.ai). */
export function cimdHosts(): string[] {
  const raw = process.env.MCP_OAUTH_CIMD_HOSTS;
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_CIMD_HOSTS];
  return raw
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

/**
 * Custom redirect schemes DCR clients may register. Unset or blank: any private-use scheme (cursor://, vscode://,
 * com.example.app:/), minus the forbidden list in redirect.ts. Set (MCP_OAUTH_DCR_SCHEMES, comma-separated): only
 * those schemes; a value with no valid scheme, e.g. `none`, turns custom schemes off.
 */
export function dcrSchemePolicy(): SchemePolicy {
  const raw = process.env.MCP_OAUTH_DCR_SCHEMES;
  if (raw === undefined || raw.trim() === '') return 'private_use';
  return raw
    .split(',')
    .map((scheme) => scheme.trim().toLowerCase().replace(/:$/, ''))
    .filter((scheme) => /^[a-z][a-z0-9+.-]*$/.test(scheme) && scheme !== 'none' && !isForbiddenScheme(scheme));
}

/**
 * Optional https host allowlist for DCR redirect URIs (MCP_OAUTH_DCR_REDIRECT_HOSTS, comma-separated). Unset or empty
 * means any https host: DCR is open self-registration for any standard MCP client. Loopback is never affected.
 */
export function dcrRedirectHosts(): string[] | null {
  const hosts = (process.env.MCP_OAUTH_DCR_REDIRECT_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
  return hosts.length > 0 ? hosts : null;
}

/** Called at server start: throws when the flag is on and the issuer is missing (production) or malformed. */
export function validateOAuthConfig(): void {
  if (!oauthEnabled()) return;
  oauthIssuer();
}

/**
 * §2.5: `resource` must be RESOURCE. An uppercase scheme or host and one trailing slash are accepted, then
 * normalized. Returns RESOURCE, or null for anything else.
 */
export function normalizeResource(value: string): string | null {
  const expected = oauthResource();
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]+)(\/[^?#]*)?$/.exec(value);
  if (!match) return null;
  const [, scheme, host, rawPath] = match;
  const path = (rawPath ?? '').replace(/\/$/, '');
  const candidate = `${scheme!.toLowerCase()}://${host!.toLowerCase()}${path}`;
  return candidate === expected ? expected : null;
}

/**
 * §2.5, §5.10: the scope a request may carry. Keeps `agent` plus, while MCP_OAUTH_OWNER_SCOPE=1, the higher scopes the
 * client asked for; drops offline_access, openid and anything unknown. `agent` is always the base, so a request for no
 * scope (or only unknown ones) is `agent`. Canonical order, no duplicates.
 */
export function grantableScope(scope: string | null | undefined): string {
  return effectiveScopes(scope).join(' ');
}

/** grantableScope as a list: `agent` first, then each supported higher scope present in `scope`. */
export function effectiveScopes(scope: string | null | undefined): string[] {
  const asked = new Set((scope ?? '').split(' '));
  return [OAUTH_SCOPE, ...oauthScopesSupported().filter((value) => value !== OAUTH_SCOPE && asked.has(value))];
}
