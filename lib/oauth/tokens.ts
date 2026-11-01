import { randomToken, sha256 } from '../crypto';

/** docs/design/mcp-oauth.md §3: distinct prefixes, each followed by 32 random bytes in base64url (43 chars). */
export const TOKEN_PREFIX = {
  access: 'rsoa_',
  refresh: 'rsor_',
  code: 'rsoc_',
  dcrClientId: 'rsdc_',
  dcrClientSecret: 'rsds_',
} as const;

export type TokenKind = keyof typeof TOKEN_PREFIX;

export function mintToken(kind: TokenKind): { token: string; hash: string } {
  const token = randomToken(TOKEN_PREFIX[kind]);
  return { token, hash: sha256(token) };
}

/** A random value with no prefix: the consent `req` token and the binding cookie. */
export function mintOpaque(): { token: string; hash: string } {
  const token = randomToken('');
  return { token, hash: sha256(token) };
}

export function hasPrefix(token: string, kind: TokenKind): boolean {
  return token.startsWith(TOKEN_PREFIX[kind]);
}

/** For a log scrubber: every OAuth token, code or DCR credential. */
export const OAUTH_TOKEN_PATTERN = /rso[acr]_[A-Za-z0-9_-]{43}|rsd[cs]_[A-Za-z0-9_-]{43}/g;

/** 43-char base64url, the shape of the consent `req` token. */
export const REQUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Injectable clock, so tests can step past the refresh race window and expiries. */
let clock: (() => number) | null = null;

export function setOAuthClockForTests(fn: (() => number) | null): void {
  clock = fn;
}

export function oauthNow(): Date {
  return new Date(clock ? clock() : Date.now());
}
