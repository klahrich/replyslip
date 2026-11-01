import { createHash } from 'node:crypto';
import { safeEqualString } from '../crypto';

/** RFC 7636 §4.1: 43–128 unreserved characters. The same shape for the S256 challenge we accept. */
const PKCE_VALUE = /^[A-Za-z0-9\-._~]{43,128}$/;

export function isValidCodeChallenge(challenge: unknown): challenge is string {
  return typeof challenge === 'string' && PKCE_VALUE.test(challenge);
}

export function isValidCodeVerifier(verifier: unknown): verifier is string {
  return typeof verifier === 'string' && PKCE_VALUE.test(verifier);
}

/** S256 only. `plain` and a missing method are refused, never defaulted. */
export function isSupportedChallengeMethod(method: unknown): boolean {
  return method === 'S256';
}

export function s256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** BASE64URL(SHA256(verifier)) equals the stored challenge, compared in constant time. */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier)) return false;
  return safeEqualString(s256(verifier), challenge);
}
