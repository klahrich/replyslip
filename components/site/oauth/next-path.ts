/**
 * Where /sign-in may send someone after the code step. Only the consent page passes; everything else (absolute
 * URLs, //host, backslashes, encoded tricks, extra parameters) goes to /dashboard.
 *
 * The same rule and names as lib/oauth/next-path.ts in PlumberBot's PR #141 (docs/design/mcp-oauth.md §5.5). Once
 * that merges, the two exports below become a re-export from there.
 */
export const DEFAULT_NEXT_PATH = '/dashboard';
const CONSENT_NEXT = /^\/oauth\/consent\?req=[A-Za-z0-9_-]{43}$/;

export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string') return DEFAULT_NEXT_PATH;
  return CONSENT_NEXT.test(next) ? next : DEFAULT_NEXT_PATH;
}

/** The consent request token as it appears in /oauth/consent?req=… (43 base64url characters). */
export const CONSENT_REQUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function consentPath(req: string): string {
  return `/oauth/consent?req=${req}`;
}
