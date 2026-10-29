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

/**
 * CSRF guard for cookie-authenticated POSTs. A browser always sends Origin on a cross-site POST, so a
 * present Origin must match exactly. When APP_ORIGIN is set (production), it is the only allowed origin:
 * Host and X-Forwarded-Host come from the client and are not trusted. Without APP_ORIGIN (local dev and
 * previews) the request's own origin is used. No Origin means a non-browser client.
 */
export function assertSameOrigin(req: Request): void {
  const site = req.headers.get('sec-fetch-site');
  if (site === 'cross-site') throw new HttpError(403, 'bad_origin', 'This request came from another site.');
  const origin = req.headers.get('origin');
  if (origin === null) return;
  const configured = process.env.APP_ORIGIN?.trim().replace(/\/$/, '');
  const allowed = configured || requestOrigin(req);
  if (origin !== allowed) throw new HttpError(403, 'bad_origin', 'This request came from another site.');
}
