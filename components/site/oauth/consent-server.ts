import type { SessionUser } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { loadConsentRequest } from '@/lib/oauth/consent';
import { problemFromCode } from './consent-logic';
import type { ConsentProblem, ConsentView } from './consent-types';

export type ConsentLoad = { kind: 'view'; view: ConsentView } | { kind: 'problem'; problem: ConsentProblem };

/** Loads the request for the page (lib/oauth/consent.ts), turning its four expected HttpErrors into a plain message. */
export async function loadConsent(req: string, user: SessionUser): Promise<ConsentLoad> {
  try {
    return { kind: 'view', view: await loadConsentRequest(req, user) };
  } catch (err) {
    const problem = err instanceof HttpError ? problemFromCode(err.code) : null;
    if (problem) return { kind: 'problem', problem };
    throw err;
  }
}
