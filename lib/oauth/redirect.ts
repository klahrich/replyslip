/**
 * Redirect URI rules (docs/design/mcp-oauth.md §5.1). Registered URIs are compared as raw strings, never normalized.
 * The one exception is RFC 8252 §7.3: a registered http loopback URI with no port matches the same URI on any port.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOOPBACK_URI = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?(\/[^#]*)?$/;
const FORBIDDEN_SCHEMES = new Set(['javascript', 'data', 'file', 'vbscript', 'blob', 'about']);

export type RedirectCheck = { ok: true } | { ok: false; reason: string };

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

export function isLoopbackRedirect(uri: string): boolean {
  return LOOPBACK_URI.test(uri);
}

/**
 * May this URI be registered or requested at all? https with no fragment, userinfo or `*`; an http loopback URI; or
 * a custom scheme from `customSchemes` (DCR only, MCP_OAUTH_DCR_SCHEMES).
 */
export function checkRedirectUri(uri: unknown, customSchemes: string[] = []): RedirectCheck {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 2000) return { ok: false, reason: 'not a URI' };
  if (/[\s\u0000-\u001f\u007f]/.test(uri)) return { ok: false, reason: 'contains whitespace or control characters' };
  if (uri.includes('*')) return { ok: false, reason: 'wildcards are not allowed' };
  if (uri.includes('#')) return { ok: false, reason: 'fragments are not allowed' };
  if (uri.includes('\\')) return { ok: false, reason: 'backslashes are not allowed' };
  const url = parse(uri);
  if (!url) return { ok: false, reason: 'not an absolute URI' };
  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  if (FORBIDDEN_SCHEMES.has(scheme)) return { ok: false, reason: `${scheme}: URIs are not allowed` };
  if (url.username || url.password || /^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(uri)) {
    return { ok: false, reason: 'userinfo is not allowed' };
  }
  if (scheme === 'https') {
    if (!url.hostname) return { ok: false, reason: 'missing host' };
    return { ok: true };
  }
  if (scheme === 'http') {
    return isLoopbackRedirect(uri) ? { ok: true } : { ok: false, reason: 'http is only allowed for loopback' };
  }
  if (customSchemes.includes(scheme)) return { ok: true };
  return { ok: false, reason: `the ${scheme}: scheme is not allowed` };
}

/** Exact match against the registered list, plus port-agnostic loopback (registered without a port). */
export function redirectUriMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const req = LOOPBACK_URI.exec(requested);
  if (!req) return false;
  const [, host, , path] = req;
  const withoutPort = `http://${host}${path ?? ''}`;
  return registered.some((uri) => {
    const reg = LOOPBACK_URI.exec(uri);
    return reg !== null && reg[2] === undefined && uri === withoutPort;
  });
}

/** Host shown on the consent page: "chatgpt.com", "claude.ai", "localhost". */
export function redirectHost(uri: string): string {
  const loop = LOOPBACK_URI.exec(uri);
  if (loop) return loop[1] === '[::1]' ? '[::1]' : loop[1]!;
  const url = parse(uri);
  if (!url) return '';
  return url.hostname || url.protocol.replace(/:$/, '');
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/** The registered URI with our params appended; a query already on it is kept (§2.6). */
export function withQuery(uri: string, params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) search.append(key, value);
  }
  const query = search.toString();
  if (!query) return uri;
  return `${uri}${uri.includes('?') ? (uri.endsWith('?') || uri.endsWith('&') ? '' : '&') : '?'}${query}`;
}
