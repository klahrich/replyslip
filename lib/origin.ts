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
