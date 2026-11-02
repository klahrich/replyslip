/**
 * Redirect URI rules (docs/design/mcp-oauth.md §5.1). Registered URIs are compared as raw strings, never normalized.
 * The one exception is RFC 8252 §7.3: a registered http loopback URI with no port matches the same URI on any port.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOOPBACK_URI = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?(\/[^#]*)?$/;
/**
 * Schemes never accepted as a redirect, whatever MCP_OAUTH_DCR_SCHEMES says: script and inline-content schemes,
 * local files, browser-internal and extension schemes, OS intent/handler schemes, and network schemes that aren't
 * an app callback. Prefix rules catch the families (chrome-*, edge-*, moz-*, ms-*, opera-*, *-extension).
 */
const FORBIDDEN_SCHEMES = new Set([
  'javascript', 'vbscript', 'livescript', 'data', 'blob', 'file', 'filesystem', 'about', 'view-source',
  'chrome', 'chromium', 'chrome-extension', 'chrome-search', 'chrome-untrusted', 'devtools', 'edge', 'brave',
  'opera', 'vivaldi', 'yandex', 'moz-extension', 'resource', 'jar', 'ms-browser-extension', 'safari-extension',
  'safari-web-extension', 'webkit', 'intent', 'android-app', 'content', 'res', 'shell', 'ws', 'wss', 'ftp',
  'mailto', 'tel', 'sms', 'urn', 'wyciwyg',
]);
const FORBIDDEN_SCHEME_PREFIXES = ['chrome-', 'edge-', 'moz-', 'ms-', 'opera-', 'brave-', 'safari-', 'webkit-'];

/** Is this scheme on the never-allowed list? */
export function isForbiddenScheme(scheme: string): boolean {
  const s = scheme.toLowerCase();
  return (
    FORBIDDEN_SCHEMES.has(s) || s.endsWith('-extension') || FORBIDDEN_SCHEME_PREFIXES.some((prefix) => s.startsWith(prefix))
  );
}

/**
 * Which non-http(s) schemes a client may use. `'private_use'`: any private-use scheme (RFC 8252 §7.1, e.g.
 * cursor://, vscode://, com.example.app:/) that is not forbidden. A list: only those schemes (still minus forbidden).
 */
export type SchemePolicy = 'private_use' | readonly string[];

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
 * a custom scheme allowed by `schemes` (DCR only, see dcrSchemePolicy). CIMD clients pass the default: no custom
 * schemes. Matching is always exact (redirectUriMatches), so a custom scheme URI never matches a variant.
 */
export function checkRedirectUri(uri: unknown, schemes: SchemePolicy = []): RedirectCheck {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 2000) return { ok: false, reason: 'not a URI' };
  if (/[\s\u0000-\u001f\u007f]/.test(uri)) return { ok: false, reason: 'contains whitespace or control characters' };
  if (uri.includes('*')) return { ok: false, reason: 'wildcards are not allowed' };
  if (uri.includes('#')) return { ok: false, reason: 'fragments are not allowed' };
  if (uri.includes('\\')) return { ok: false, reason: 'backslashes are not allowed' };
  const url = parse(uri);
  if (!url) return { ok: false, reason: 'not an absolute URI' };
  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  if (isForbiddenScheme(scheme)) return { ok: false, reason: `${scheme}: URIs are not allowed` };
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
  if (schemes === 'private_use' || schemes.includes(scheme)) return { ok: true };
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

export type RedirectKind = 'https' | 'loopback' | 'custom_scheme';

/** For the consent page's warnings (ConsentView.redirect.kind / scheme). */
export function redirectKind(uri: string): { kind: RedirectKind; scheme: string | null } {
  if (isLoopbackRedirect(uri)) return { kind: 'loopback', scheme: null };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(uri)?.[1]?.toLowerCase() ?? '';
  if (scheme === 'https') return { kind: 'https', scheme: null };
  return { kind: 'custom_scheme', scheme };
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
