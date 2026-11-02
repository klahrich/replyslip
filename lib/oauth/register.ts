import { getDb } from '@/db';
import { oauthClients } from '@/db/schema';
import { keyedHash } from '../crypto';
import { consumeKeyedRateLimit } from '../rate-limit';
import { sanitizeClientName } from './cimd';
import { dcrRedirectHosts, dcrSchemes, OAUTH_SCOPE } from './config';
import {
  OAUTH_DCR_FALLBACK_NAME,
  OAUTH_DCR_GLOBAL_DAILY,
  OAUTH_DCR_MAX_NAME_INPUT,
  OAUTH_DCR_MAX_REDIRECT_URIS,
  OAUTH_DCR_MAX_URI_LENGTH,
} from './constants';
import { OAuthError } from './errors';
import { rateLimited } from './http';
import { checkRedirectUri, isLoopbackRedirect } from './redirect';
import { mintToken, oauthNow } from './tokens';

/**
 * Dynamic Client Registration (RFC 7591), docs/design/mcp-oauth.md §2.4.2 and §5.2. Open self-registration for any
 * standard MCP client, behind MCP_OAUTH_DCR. Every DCR client is a public client: we never issue a secret. A request
 * for client_secret_post or client_secret_basic is registered as `none`, which RFC 7591 §3.2.1 allows (the server may
 * replace requested metadata, and the response is the registered state). PKCE S256 is enforced at /authorize for
 * every client. Registration only creates a row: nothing is granted without a signed-in user clicking Allow, and the
 * consent page always labels a DCR client "Unverified app" with its redirect host.
 */

const AUTH_METHODS = new Set(['none', 'client_secret_post', 'client_secret_basic']);
const GRANT_TYPES = new Set(['authorization_code', 'refresh_token']);
const APPLICATION_TYPES = new Set(['web', 'native']);

/** Names a DCR client may not take: anyone can register, so it must not look like a verified app. */
const RESERVED_NAMES = ['chatgpt', 'openai', 'claude', 'anthropic'];

/** Homoglyph-lite: Latin look-alikes from Cyrillic and Greek, and digit or symbol swaps, folded to ASCII letters. */
const CONFUSABLES: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  і: 'i', ї: 'i', ј: 'j', ԁ: 'd', һ: 'h', ӏ: 'l', ѕ: 's', ԛ: 'q', ԝ: 'w',
  α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ϲ: 'c',
  '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '€': 'e',
};

function fold(name: string, oneAs: 'l' | 'i'): string {
  const base = name
    // Lunate sigma and Roman numeral C look like "c" but NFKD turns them into σ and c only partly; fold them first.
    .replace(/[\u03f2\u03f9\u216d\u217d]/g, 'c')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  let out = '';
  for (const char of base) {
    // "1", "|", "!", capital I and small l all read alike, so each variant folds the whole group one way.
    if (char === '1' || char === '|' || char === '!' || char === 'l' || char === 'i') out += oneAs;
    else out += CONFUSABLES[char] ?? char;
  }
  // Separators, punctuation and spacing tricks ("C.l a-u_d e") don't hide a name. "rn" reads as "m"; "vv" as "w".
  return out.replace(/[^a-z]/g, '').replace(/rn/g, 'm').replace(/vv/g, 'w');
}

/** True when a self-asserted name contains ChatGPT, OpenAI, Claude or Anthropic, even disguised. */
export function impersonatesKnownApp(name: string): boolean {
  const variants = [fold(name, 'l'), fold(name, 'i')];
  return variants.some((folded) => RESERVED_NAMES.some((reserved) => folded.includes(reserved)));
}

/** Sanitized display name: control and bidi characters stripped, at most 100 characters, impersonation replaced. */
export function dcrClientName(raw: unknown): string {
  if (typeof raw !== 'string') return OAUTH_DCR_FALLBACK_NAME;
  const name = sanitizeClientName(raw);
  if (!name || impersonatesKnownApp(name)) return OAUTH_DCR_FALLBACK_NAME;
  return name;
}

function fail(code: 'invalid_redirect_uri' | 'invalid_client_metadata', description: string): never {
  throw new OAuthError(code, description);
}

function checkRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) fail('invalid_redirect_uri', 'redirect_uris must be a non-empty array.');
  if (value.length > OAUTH_DCR_MAX_REDIRECT_URIS) {
    fail('invalid_redirect_uri', `At most ${OAUTH_DCR_MAX_REDIRECT_URIS} redirect_uris are allowed.`);
  }
  const hosts = dcrRedirectHosts();
  const schemes = dcrSchemes();
  for (const uri of value) {
    if (typeof uri !== 'string' || uri.length > OAUTH_DCR_MAX_URI_LENGTH) {
      fail('invalid_redirect_uri', 'Each redirect URI must be a string of at most 2000 characters.');
    }
    // https (no fragment, userinfo or wildcard), http loopback (RFC 8252), or a scheme in MCP_OAUTH_DCR_SCHEMES.
    if (!checkRedirectUri(uri, schemes).ok) {
      fail('invalid_redirect_uri', 'Redirect URIs must be https, http loopback, or an allowed custom scheme.');
    }
    if (hosts && uri.toLowerCase().startsWith('https:') && !hosts.includes(new URL(uri).hostname.toLowerCase())) {
      fail('invalid_redirect_uri', 'This redirect host is not allowed.');
    }
  }
  return [...new Set(value as string[])];
}

function checkStringList(value: unknown, allowed: Set<string>, field: string, fallback: string[]): string[] {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value) || value.length === 0 || value.length > 10 || value.some((item) => typeof item !== 'string')) {
    fail('invalid_client_metadata', `${field} must be a non-empty array of strings.`);
  }
  if (value.some((item) => !allowed.has(item as string))) fail('invalid_client_metadata', `${field} has an unsupported value.`);
  return [...new Set(value as string[])];
}

/** client_uri is display-only. Kept only when https and on the host of a registered https redirect URI. */
function checkClientUri(value: unknown, redirectUris: string[]): string | null {
  if (typeof value !== 'string' || value.length > OAUTH_DCR_MAX_URI_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const redirectHosts = redirectUris
    .filter((uri) => uri.startsWith('https://'))
    .map((uri) => new URL(uri).hostname.toLowerCase());
  return redirectHosts.includes(url.hostname.toLowerCase()) ? url.origin : null;
}

export type RegistrationInput = Record<string, unknown>;

export type ValidatedRegistration = {
  redirectUris: string[];
  clientName: string;
  clientUri: string | null;
  grantTypes: string[];
  applicationType: 'web' | 'native';
};

/** RFC 7591 §2 validation. Unknown fields are ignored; scope is always narrowed to `agent` (§5.7). */
export function validateRegistration(body: unknown): ValidatedRegistration {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_client_metadata', 'Send a JSON object.');
  const input = body as RegistrationInput;
  const redirectUris = checkRedirectUris(input.redirect_uris);
  const method = input.token_endpoint_auth_method;
  if (method !== undefined && (typeof method !== 'string' || !AUTH_METHODS.has(method))) {
    fail('invalid_client_metadata', 'token_endpoint_auth_method must be none.');
  }
  const grantTypes = checkStringList(input.grant_types, GRANT_TYPES, 'grant_types', ['authorization_code', 'refresh_token']);
  if (!grantTypes.includes('authorization_code')) {
    fail('invalid_client_metadata', 'grant_types must include authorization_code.');
  }
  checkStringList(input.response_types, new Set(['code']), 'response_types', ['code']);
  const appType = input.application_type;
  if (appType !== undefined && (typeof appType !== 'string' || !APPLICATION_TYPES.has(appType))) {
    fail('invalid_client_metadata', 'application_type must be web or native.');
  }
  if (typeof input.client_name === 'string' && input.client_name.length > OAUTH_DCR_MAX_NAME_INPUT) {
    fail('invalid_client_metadata', 'client_name is too long.');
  }
  const allLoopback = redirectUris.every((uri) => isLoopbackRedirect(uri) || !uri.startsWith('https://'));
  return {
    redirectUris,
    clientName: dcrClientName(input.client_name),
    clientUri: checkClientUri(input.client_uri, redirectUris),
    grantTypes,
    applicationType: (appType as 'web' | 'native' | undefined) ?? (allLoopback ? 'native' : 'web'),
  };
}

/** RFC 7591 §3.2.1 response body. Public client: no client_secret, auth method always `none`. */
export type RegistrationResponse = {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  client_uri?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: 'none';
  grant_types: string[];
  response_types: ['code'];
  application_type: 'web' | 'native';
  scope: string;
};

/**
 * Validates, applies the global daily cap (the per-IP limit is checked by the route first), and stores the client.
 * The raw IP is never stored, only keyedHash('oauth-dcr-ip', ip).
 */
export async function registerClient(body: unknown, ip: string): Promise<RegistrationResponse> {
  const reg = validateRegistration(body);
  const now = oauthNow();
  const { token: clientId } = mintToken('dcrClientId');
  const row = await getDb().transaction(async (tx) => {
    const cap = await consumeKeyedRateLimit(tx, {
      kind: 'oauthRegisterGlobal',
      key: 'global',
      limit: OAUTH_DCR_GLOBAL_DAILY,
      windowMs: 24 * 60 * 60 * 1000,
    });
    if (cap.limited) {
      throw rateLimited(cap.retryAfterSeconds);
    }
    const [inserted] = await tx
      .insert(oauthClients)
      .values({
        clientId,
        kind: 'dcr',
        clientName: reg.clientName,
        clientUri: reg.clientUri,
        redirectUris: reg.redirectUris,
        tokenEndpointAuthMethod: 'none',
        clientSecretHash: null,
        grantTypes: reg.grantTypes,
        applicationType: reg.applicationType,
        registeredIpHash: keyedHash('oauth-dcr-ip', ip),
        createdAt: now,
      })
      .returning();
    return inserted!;
  });
  console.info(JSON.stringify({ event: 'oauth.dcr_registered', client: row.id, app_type: reg.applicationType }));
  return {
    client_id: row.clientId,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: row.clientName,
    ...(row.clientUri ? { client_uri: row.clientUri } : {}),
    redirect_uris: reg.redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: reg.grantTypes,
    response_types: ['code'],
    application_type: reg.applicationType,
    scope: OAUTH_SCOPE,
  };
}
