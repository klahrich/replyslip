/**
 * Where /sign-in may send someone after the code step. Only the consent page passes; everything else (absolute
 * URLs, //host, backslashes, encoded tricks, extra parameters) goes to /dashboard.
 *
 * docs/design/mcp-oauth.md §5.5 puts this check in lib/oauth/next-path.ts (`safeNextPath`), shared by server and
 * browser. Until PlumberBot's PR lands, this file holds the same rule; then it becomes a re-export of that function.
 */
export const DEFAULT_NEXT_PATH = '/dashboard';
const CONSENT_NEXT = /^\/oauth\/consent\?req=[A-Za-z0-9_-]{43}$/;

export function safeNextPath(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && CONSENT_NEXT.test(raw) ? raw : DEFAULT_NEXT_PATH;
}

/** The consent request token as it appears in /oauth/consent?req=… (43 base64url characters). */
export const CONSENT_REQUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function consentPath(req: string): string {
  return `/oauth/consent?req=${req}`;
}
