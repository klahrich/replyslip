import { and, eq, isNull } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import { oauthClients, oauthGrants, type OAuthClientRow } from '@/db/schema';
import { OAUTH_CIMD_STALE_OK_MS } from './constants';
import { safeEqualHex, sha256 } from '../crypto';
import { cimdHosts } from './config';
import { CimdError, checkCimdUrl, fetchCimdDocument, isCimdClientId } from './cimd';
import { OAuthError } from './errors';
import { TOKEN_PREFIX, oauthNow } from './tokens';

/** Resolving and authenticating OAuth clients (docs/design/mcp-oauth.md §2.4, §2.7). */

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...fields }));
}

async function findClient(db: Db, clientId: string): Promise<OAuthClientRow | null> {
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  return row ?? null;
}

async function refreshCimd(clientId: string, cached: OAuthClientRow | null): Promise<OAuthClientRow> {
  const now = oauthNow();
  let fetched: Awaited<ReturnType<typeof fetchCimdDocument>>;
  try {
    fetched = await fetchCimdDocument(clientId);
  } catch (error) {
    const reason = error instanceof CimdError ? error.message : 'fetch failed';
    if (cached?.metadataFetchedAt && now.getTime() - cached.metadataFetchedAt.getTime() < OAUTH_CIMD_STALE_OK_MS) {
      logEvent('oauth.cimd_stale', { client: cached.id, reason });
      return cached;
    }
    logEvent('oauth.cimd_failed', { reason });
    throw new OAuthError('invalid_client', 'The client metadata document could not be used.');
  }
  const { document, cacheMs } = fetched;
  const values = {
    clientId,
    kind: 'cimd' as const,
    clientName: document.clientName,
    clientUri: document.clientUri,
    redirectUris: document.redirectUris,
    tokenEndpointAuthMethod: 'none' as const,
    clientSecretHash: null,
    grantTypes: document.grantTypes,
    metadataExpiresAt: new Date(now.getTime() + cacheMs),
    metadataFetchedAt: now,
  };
  const [row] = await getDb()
    .insert(oauthClients)
    .values(values)
    .onConflictDoUpdate({
      target: oauthClients.clientId,
      set: {
        clientName: values.clientName,
        clientUri: values.clientUri,
        redirectUris: values.redirectUris,
        grantTypes: values.grantTypes,
        metadataExpiresAt: values.metadataExpiresAt,
        metadataFetchedAt: values.metadataFetchedAt,
      },
    })
    .returning();
  if (!row) throw new OAuthError('server_error', 'Something went wrong.', 500);
  return row;
}

/**
 * The client behind a client_id: a CIMD URL on an allowlisted host (fetched or cached), or a DCR row. Anything else,
 * or a disabled client, is invalid_client. `refresh` controls whether an expired CIMD cache is refetched (true on
 * /authorize; the token endpoint uses the stored row).
 */
export async function resolveClient(clientId: unknown, options: { refresh?: boolean } = {}): Promise<OAuthClientRow> {
  if (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > 2000) {
    throw new OAuthError('invalid_client', 'Unknown client.');
  }
  const db = getDb();
  if (isCimdClientId(clientId)) {
    try {
      checkCimdUrl(clientId);
    } catch {
      throw new OAuthError('invalid_client', 'This client is not allowed.');
    }
    const cached = await findClient(db, clientId);
    if (cached && cached.kind !== 'cimd') throw new OAuthError('invalid_client', 'Unknown client.');
    if (cached?.disabledAt) throw new OAuthError('invalid_client', 'This client is disabled.');
    const fresh = cached?.metadataExpiresAt && cached.metadataExpiresAt.getTime() > oauthNow().getTime();
    if (cached && (fresh || options.refresh === false)) return cached;
    return refreshCimd(clientId, cached);
  }
  if (clientId.startsWith(TOKEN_PREFIX.dcrClientId)) {
    const row = await findClient(db, clientId);
    if (!row || row.kind !== 'dcr') throw new OAuthError('invalid_client', 'Unknown client.');
    if (row.disabledAt) throw new OAuthError('invalid_client', 'This client is disabled.');
    return row;
  }
  throw new OAuthError('invalid_client', 'Unknown client.');
}

/** The client credentials a token or revoke request carried. */
export type ClientCredentials = { clientId: string | null; clientSecret: string | null; method: 'none' | 'basic' | 'post' };

/** Reads `Authorization: Basic` (RFC 6749 §2.3.1: form-urlencoded id and secret) or body fields. */
export function readClientCredentials(authorization: string | null, form: URLSearchParams): ClientCredentials {
  if (authorization && /^basic\s+/i.test(authorization)) {
    let decoded = '';
    try {
      decoded = Buffer.from(authorization.replace(/^basic\s+/i, '').trim(), 'base64').toString('utf8');
    } catch {
      decoded = '';
    }
    const colon = decoded.indexOf(':');
    if (colon < 0) throw new OAuthError('invalid_client', 'Client authentication failed.');
    const decode = (value: string) => {
      try {
        return decodeURIComponent(value.replace(/\+/g, ' '));
      } catch {
        throw new OAuthError('invalid_client', 'Client authentication failed.');
      }
    };
    const clientId = decode(decoded.slice(0, colon));
    // A client_id in the body as well must name the same client (RFC 6749 §2.3: one client per request).
    const bodyClientId = form.get('client_id');
    if (bodyClientId !== null && bodyClientId !== clientId) {
      throw new OAuthError('invalid_client', 'Client authentication failed.');
    }
    return { clientId, clientSecret: decode(decoded.slice(colon + 1)), method: 'basic' };
  }
  const clientSecret = form.get('client_secret');
  return { clientId: form.get('client_id'), clientSecret, method: clientSecret === null ? 'none' : 'post' };
}

/** Resolve the client from stored rows and check its credentials against its registered method. */
export async function authenticateClient(credentials: ClientCredentials): Promise<OAuthClientRow> {
  const client = await resolveClient(credentials.clientId, { refresh: false });
  const expected =
    client.tokenEndpointAuthMethod === 'client_secret_basic'
      ? 'basic'
      : client.tokenEndpointAuthMethod === 'client_secret_post'
        ? 'post'
        : 'none';
  if (expected === 'none') {
    // Public client: no secret was ever issued, so one sent anyway (Basic or client_secret, as Codex and some SDKs do
    // after asking for client_secret_*) is ignored rather than refused. It proves nothing either way: the client is
    // identified by client_id, and the code is bound to it, its exact redirect URI and the PKCE verifier.
    return client;
  }
  if (
    credentials.method !== expected ||
    !credentials.clientSecret ||
    !client.clientSecretHash ||
    !safeEqualHex(sha256(credentials.clientSecret), client.clientSecretHash)
  ) {
    throw new OAuthError('invalid_client', 'Client authentication failed.');
  }
  return client;
}

export async function touchClient(clientRowId: string): Promise<void> {
  await getDb().update(oauthClients).set({ lastUsedAt: oauthNow() }).where(eq(oauthClients.id, clientRowId));
}

/** Operator kill switch: block the client and revoke its grants (client_disabled). */
export async function disableClient(clientRowId: string): Promise<void> {
  const now = oauthNow();
  await getDb().transaction(async (tx) => {
    await tx.update(oauthClients).set({ disabledAt: now }).where(eq(oauthClients.id, clientRowId));
    await tx
      .update(oauthGrants)
      .set({ revokedAt: now, revokedReason: 'client_disabled' })
      .where(and(eq(oauthGrants.clientId, clientRowId), isNull(oauthGrants.revokedAt)));
  });
}

export type ClientDisplay = {
  display_name: string;
  client_name: string;
  verified: boolean;
  kind: 'cimd' | 'dcr';
  client_uri_host: string | null;
  logo_url: null;
};

function hostOf(uri: string | null): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).hostname || null;
  } catch {
    return null;
  }
}

/** §6.1: CIMD clients are named by the client_id host; DCR clients by their self-asserted name, never verified. */
export function clientDisplay(client: OAuthClientRow): ClientDisplay {
  if (client.kind === 'cimd') {
    const host = hostOf(client.clientId) ?? client.clientName;
    return {
      display_name: host,
      client_name: client.clientName,
      verified: cimdHosts().includes(host),
      kind: 'cimd',
      client_uri_host: hostOf(client.clientUri),
      logo_url: null,
    };
  }
  return {
    display_name: client.clientName,
    client_name: client.clientName,
    verified: false,
    kind: 'dcr',
    client_uri_host: hostOf(client.clientUri),
    logo_url: null,
  };
}
