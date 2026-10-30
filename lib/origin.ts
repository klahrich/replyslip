import { HttpError } from './errors';

/** Public origin for this request, so docs work before a domain is attached. */
export function requestOrigin(req: Request): string {
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host')?.trim();
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (host) {
    const proto = forwardedProto || new URL(req.url).protocol.replace(':', '') || 'https';
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

export function absoluteUrl(origin: string, path: string): string {
  if (!origin) return path;
  return `${origin.replace(/\/$/, '')}${path}`;
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded.slice(0, 128);
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 128);
  return 'unknown';
}

/** A misconfigured APP_ORIGIN. Thrown on the first read so it can't silently never match. */
export class OriginConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OriginConfigError';
  }
}

/** Entry must already be exactly `new URL(entry).origin`: lowercase scheme://host[:port], no path, no default port. */
function assertCanonicalOrigin(name: string, entry: string): string {
  let origin: string;
  try {
    origin = new URL(entry).origin;
  } catch {
    origin = 'null';
  }
  if (origin === 'null') {
    throw new OriginConfigError(`${name} entry "${entry}" is not an origin. Use scheme://host[:port], e.g. https://replyslip.com.`);
  }
  if (origin !== entry) {
    throw new OriginConfigError(
      `${name} entry "${entry}" is not in canonical form; write it as "${origin}" (lowercase host, no path, no default port).`,
    );
  }
  return entry;
}

function trimEntry(entry: string): string {
  return entry.trim().replace(/\/+$/, '');
}

/** Production deployment: VERCEL_ENV=production, or NODE_ENV=production off Vercel (previews also run NODE_ENV=production). */
export function isProductionDeployment(): boolean {
  const vercel = process.env.VERCEL_ENV;
  if (vercel) return vercel === 'production';
  return process.env.NODE_ENV === 'production';
}

let warnedUnsetInProduction = false;

/** Lets tests see the once-only warnings again. */
export function resetOriginWarningsForTests(): void {
  warnedUnsetInProduction = false;
}

/**
 * APP_ORIGIN as a list: comma-separated, each entry trimmed with its trailing slash removed; empty entries and a
 * literal `null` (so `Origin: null` can never match) are dropped. Every other entry must already be a canonical
 * origin, or this throws OriginConfigError. Empty when APP_ORIGIN is unset or blank; in production that logs one
 * loud warning, because the Origin check then trusts the request's own Host.
 */
export function configuredOrigins(raw: string | undefined = process.env.APP_ORIGIN): string[] {
  const entries = (raw ?? '')
    .split(',')
    .map(trimEntry)
    .filter((entry) => entry.length > 0 && entry !== 'null')
    .map((entry) => assertCanonicalOrigin('APP_ORIGIN', entry));
  if (entries.length === 0 && isProductionDeployment() && !warnedUnsetInProduction) {
    warnedUnsetInProduction = true;
    console.warn(
      '[replyslip] WARNING: APP_ORIGIN is not set in production. The Origin check trusts the request Host and links use ' +
        'the request origin. Set APP_ORIGIN to the public origin(s), e.g. https://replyslip.com.',
    );
  }
  return entries;
}

/** Throws OriginConfigError when APP_ORIGIN is malformed. Called at server start. */
export function validateOriginConfig(): void {
  configuredOrigins();
}

/** The first APP_ORIGIN entry, or null when APP_ORIGIN is unset. */
export function canonicalOrigin(): string | null {
  return configuredOrigins()[0] ?? null;
}

/**
 * Origin for every absolute URL the app hands out or serves (agent invite links, register/redeem MCP and docs
 * URLs, llms.txt, skill.md, docs/*.md, links in emails): the first APP_ORIGIN entry, or the request's own origin
 * when APP_ORIGIN is unset.
 */
export function publicOrigin(req: Request): string {
  return canonicalOrigin() ?? requestOrigin(req);
}

/** Origins a cookie-authenticated POST may come from: every APP_ORIGIN entry, or the request's own origin. */
export function allowedOrigins(req: Request): string[] {
  const configured = configuredOrigins();
  return configured.length > 0 ? configured : [requestOrigin(req)];
}

/**
 * CSRF guard for cookie-authenticated POSTs. A browser always sends Origin on a cross-site POST, so a
 * present Origin must exactly equal one allowed origin. When APP_ORIGIN is set (production), only its entries
 * are allowed: Host and X-Forwarded-Host come from the client and are not trusted. Without APP_ORIGIN (local
 * dev and previews) the request's own origin is used. No Origin means a non-browser client.
 */
export function assertSameOrigin(req: Request): void {
  const site = req.headers.get('sec-fetch-site');
  if (site === 'cross-site') throw new HttpError(403, 'bad_origin', 'This request came from another site.');
  const origin = req.headers.get('origin');
  if (origin === null) return;
  if (!allowedOrigins(req).includes(origin)) throw new HttpError(403, 'bad_origin', 'This request came from another site.');
}
