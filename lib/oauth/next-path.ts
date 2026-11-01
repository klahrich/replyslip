/**
 * The only path /sign-in?next= may return to (docs/design/mcp-oauth.md §5.5, §6.3): the consent page with a 43-char
 * req token. Everything else, including absolute URLs, //host, backslashes and encoded variants, falls back to
 * /dashboard. Safe to call on the server and in the browser.
 */
export const DEFAULT_NEXT_PATH = '/dashboard';
const CONSENT_NEXT = /^\/oauth\/consent\?req=[A-Za-z0-9_-]{43}$/;

export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string') return DEFAULT_NEXT_PATH;
  return CONSENT_NEXT.test(next) ? next : DEFAULT_NEXT_PATH;
}

/** True when `next` is a consent path, so the sign-in screen may say "Sign in to connect an app". */
export function isConsentNextPath(next: unknown): boolean {
  return typeof next === 'string' && CONSENT_NEXT.test(next);
}
