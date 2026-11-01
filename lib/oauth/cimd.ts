import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import {
  OAUTH_CIMD_MAX_BYTES,
  OAUTH_CIMD_MAX_CACHE_MS,
  OAUTH_CIMD_MIN_CACHE_MS,
  OAUTH_CIMD_TIMEOUT_MS,
  OAUTH_CLIENT_NAME_MAX,
} from './constants';
import { cimdHosts } from './config';
import { checkRedirectUri } from './redirect';

/**
 * Client ID Metadata Documents (docs/design/mcp-oauth.md §2.4.1). The host allowlist removes most of the SSRF
 * surface; the guard below stays anyway: https on 443 only, no IP literals, every resolved address must be public,
 * the connection goes to the address that was checked, no redirects, 5 s, 8 KB, JSON only.
 */

export class CimdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CimdError';
  }
}

export type CimdResponse = { status: number; contentType: string | null; cacheControl: string | null; body: string };
export type CimdFetcher = (url: URL) => Promise<CimdResponse>;

export type CimdDocument = {
  clientId: string;
  clientName: string;
  clientUri: string | null;
  redirectUris: string[];
  grantTypes: string[];
};

/** A client_id that parses as an https URL with a path is a CIMD client. */
export function isCimdClientId(clientId: string): boolean {
  if (!clientId.startsWith('https://')) return false;
  try {
    const url = new URL(clientId);
    return url.pathname.length > 1;
  } catch {
    return false;
  }
}

/** Throws CimdError unless the URL is fetchable under the trust policy and the SSRF guard's static rules. */
export function checkCimdUrl(clientId: string): URL {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw new CimdError('client_id is not a URL');
  }
  if (url.protocol !== 'https:') throw new CimdError('client_id must be https');
  if (url.port !== '') throw new CimdError('client_id must use port 443');
  if (url.username || url.password || clientId.includes('@')) throw new CimdError('client_id must not carry userinfo');
  if (clientId.includes('#')) throw new CimdError('client_id must not carry a fragment');
  if (url.pathname.length <= 1) throw new CimdError('client_id must have a path');
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, '')) !== 0) throw new CimdError('client_id must not be an IP literal');
  if (!cimdHosts().includes(host)) throw new CimdError('client_id host is not allowed');
  return url;
}

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

/** Loopback, RFC 1918, link-local (incl. 169.254.169.254), CGNAT, ULA, multicast, documentation and mapped ranges. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d or ::ffff:hhhh:hhhh) is refused outright. It is kept out of the BlockList, which
    // would otherwise match every plain IPv4 address against it.
    if (/^::ffff:/i.test(address)) return true;
    return BLOCKED.check(address, 'ipv6');
  }
  return true;
}

async function resolvePublic(host: string): Promise<{ address: string; family: number }> {
  const addresses = await dnsLookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) throw new CimdError('client_id host does not resolve');
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new CimdError('client_id host resolves to a private address');
  }
  return addresses[0]!;
}

/** The production fetcher: resolve, check, then connect to the checked address with SNI and Host set to the name. */
export const defaultCimdFetcher: CimdFetcher = async (url) => {
  const pinned = await resolvePublic(url.hostname);
  const lookup: LookupFunction = (_host, options, callback) => {
    if (options && typeof options === 'object' && options.all) {
      (callback as unknown as (err: null, addresses: Array<{ address: string; family: number }>) => void)(null, [
        pinned,
      ]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
  return new Promise<CimdResponse>((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: 'https:',
        hostname: url.hostname,
        servername: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'Valetto-OAuth/1.0' },
        lookup,
        timeout: OAUTH_CIMD_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : null;
        const cacheControl = typeof res.headers['cache-control'] === 'string' ? res.headers['cache-control'] : null;
        if (status !== 200) {
          res.resume();
          resolve({ status, contentType, cacheControl, body: '' });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > OAUTH_CIMD_MAX_BYTES) {
            req.destroy(new CimdError('client metadata document is too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status, contentType, cacheControl, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new CimdError('client metadata fetch timed out')));
    req.on('error', (error) => reject(error instanceof CimdError ? error : new CimdError('client metadata fetch failed')));
    req.end();
  });
};

let fetcher: CimdFetcher = defaultCimdFetcher;

/** Tests stub the network; `null` restores the real fetcher. */
export function setCimdFetcherForTests(fn: CimdFetcher | null): void {
  fetcher = fn ?? defaultCimdFetcher;
}

const STRIP = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

/** Control and bidi characters stripped, whitespace collapsed, at most 100 code points. */
export function sanitizeClientName(name: string): string {
  const clean = name.replace(STRIP, '').replace(/\s+/g, ' ').trim();
  return Array.from(clean).slice(0, OAUTH_CLIENT_NAME_MAX).join('');
}

/** `max-age` clamped to 5 min–24 h; no max-age (or no-store) gets the minimum. */
export function cimdCacheMs(cacheControl: string | null): number {
  const match = cacheControl ? /(?:^|[,\s])max-age\s*=\s*"?(\d+)"?/i.exec(cacheControl) : null;
  const ms = match ? Number(match[1]) * 1000 : 0;
  return Math.min(OAUTH_CIMD_MAX_CACHE_MS, Math.max(OAUTH_CIMD_MIN_CACHE_MS, ms));
}

/** Validates a fetched document against the URL it came from. Unknown fields are ignored. */
export function parseCimdDocument(clientId: string, response: CimdResponse): CimdDocument {
  if (response.status >= 300 && response.status < 400) throw new CimdError('client metadata redirects are not followed');
  if (response.status !== 200) throw new CimdError(`client metadata fetch returned ${response.status}`);
  const type = (response.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json' && !type.endsWith('+json')) throw new CimdError('client metadata is not JSON');
  if (Buffer.byteLength(response.body, 'utf8') > OAUTH_CIMD_MAX_BYTES) {
    throw new CimdError('client metadata document is too large');
  }
  let doc: unknown;
  try {
    doc = JSON.parse(response.body);
  } catch {
    throw new CimdError('client metadata is not valid JSON');
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new CimdError('client metadata is not an object');
  const d = doc as Record<string, unknown>;
  if (d.client_id !== clientId) throw new CimdError('client metadata client_id does not match its URL');
  if (!Array.isArray(d.redirect_uris) || d.redirect_uris.length === 0) {
    throw new CimdError('client metadata has no redirect_uris');
  }
  // Only URIs we would accept at authorize are kept; at least one must survive.
  const redirectUris = d.redirect_uris.filter(
    (uri): uri is string => typeof uri === 'string' && checkRedirectUri(uri).ok,
  );
  if (redirectUris.length === 0) throw new CimdError('client metadata has no acceptable redirect_uris');
  const method = d.token_endpoint_auth_method;
  const methods = d.token_endpoint_auth_methods_supported;
  const allowsNone = method === 'none' || (Array.isArray(methods) && methods.includes('none'));
  if (!allowsNone) throw new CimdError('client metadata does not allow token_endpoint_auth_method none');
  let grantTypes = ['authorization_code', 'refresh_token'];
  if (d.grant_types !== undefined) {
    if (!Array.isArray(d.grant_types) || !d.grant_types.includes('authorization_code')) {
      throw new CimdError('client metadata grant_types must include authorization_code');
    }
    grantTypes = grantTypes.filter((grant) => (d.grant_types as unknown[]).includes(grant));
  }
  const host = new URL(clientId).hostname;
  const name = typeof d.client_name === 'string' ? sanitizeClientName(d.client_name) : '';
  let clientUri: string | null = null;
  if (typeof d.client_uri === 'string') {
    try {
      const parsed = new URL(d.client_uri);
      if (parsed.protocol === 'https:') clientUri = parsed.origin;
    } catch {
      clientUri = null;
    }
  }
  return { clientId, clientName: name || host, clientUri, redirectUris, grantTypes };
}

/** Fetch and validate. Throws CimdError on any failure; callers map that to invalid_client. */
export async function fetchCimdDocument(clientId: string): Promise<{ document: CimdDocument; cacheMs: number }> {
  const url = checkCimdUrl(clientId);
  const response = await fetcher(url);
  const document = parseCimdDocument(clientId, response);
  return { document, cacheMs: cimdCacheMs(response.cacheControl) };
}
