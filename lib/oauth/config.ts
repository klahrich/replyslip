import { isProductionDeployment } from '../origin';

/**
 * MCP OAuth configuration (docs/design/mcp-oauth.md §2). Every value is read on each call, so tests and deploys can
 * flip the flags. Nothing here derives a URL from Host or X-Forwarded-Host.
 */

/** Production issuer. Used for the /api/mcp challenge when MCP_OAUTH_ISSUER is unset. */
export const DEFAULT_ISSUER = 'https://valetto.tech';
export const DEFAULT_CIMD_HOSTS = ['chatgpt.com', 'claude.ai'];
export const OAUTH_SCOPE = 'agent';
/** Internal scope strings: only an rsk_ key holds them. Never advertised, never grantable (§5.7). */
export const SCOPE_RESPOND = 'agent:respond';
export const SCOPE_OWNER = 'agent:owner';
export const RSK_SCOPES = [OAUTH_SCOPE, SCOPE_RESPOND, SCOPE_OWNER];
export const OAUTH_SCOPES = [OAUTH_SCOPE];

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

/** Custom redirect schemes DCR clients may register (MCP_OAUTH_DCR_SCHEMES, comma-separated; default none). */
export function dcrSchemes(): string[] {
  return (process.env.MCP_OAUTH_DCR_SCHEMES ?? '')
    .split(',')
    .map((scheme) => scheme.trim().toLowerCase().replace(/:$/, ''))
    .filter((scheme) => /^[a-z][a-z0-9+.-]*$/.test(scheme));
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

/** §2.5: keep only `agent`; drop offline_access, openid, agent:respond, agent:owner and anything unknown. */
export function grantableScope(scope: string | null | undefined): string {
  const kept = (scope ?? '')
    .split(' ')
    .filter((value) => OAUTH_SCOPES.includes(value));
  return kept.length > 0 ? [...new Set(kept)].join(' ') : OAUTH_SCOPE;
}
