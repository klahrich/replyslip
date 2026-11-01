import type { SessionUser } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { problemFromCode } from './consent-logic';
import type { ConsentProblem, ConsentView } from './consent-types';

export type ConsentLoad = { kind: 'view'; view: ConsentView } | { kind: 'problem'; problem: ConsentProblem };

/**
 * Stand-in for `loadConsentRequest` from lib/oauth/consent.ts (PlumberBot's server PR, docs/design/mcp-oauth.md §6.1).
 * Until that lands there are no requests, so every link reads as not found. When it lands, delete this function
 * and import the real one; `loadConsent` below stays as is.
 */
async function loadConsentRequest(req: string, user: SessionUser): Promise<ConsentView> {
  void req;
  void user;
  throw new HttpError(404, 'request_not_found', 'Consent request not found.');
}

/** Loads the request for the page, turning the four expected HttpErrors into a plain message. */
export async function loadConsent(req: string, user: SessionUser): Promise<ConsentLoad> {
  try {
    return { kind: 'view', view: await loadConsentRequest(req, user) };
  } catch (err) {
    const problem = err instanceof HttpError ? problemFromCode(err.code) : null;
    if (problem) return { kind: 'problem', problem };
    throw err;
  }
}
