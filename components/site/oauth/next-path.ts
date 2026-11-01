/** Where /sign-in may go after the code step: only the consent page (lib/oauth/next-path.ts, docs §5.5). */
export { DEFAULT_NEXT_PATH, safeNextPath } from '@/lib/oauth/next-path';

/** The consent request token as it appears in /oauth/consent?req=… (43 base64url characters). */
export { REQUEST_TOKEN_PATTERN as CONSENT_REQUEST_TOKEN } from '@/lib/oauth/tokens';

export function consentPath(req: string): string {
  return `/oauth/consent?req=${req}`;
}
