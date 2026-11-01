/** The consent page's side of docs/design/mcp-oauth.md §6.1–6.2. The view type is the server's own. */
export type { ConsentView } from '@/lib/oauth/consent';

/** Why the page can't show the request. Matches the HttpError codes loadConsentRequest throws. */
export type ConsentProblem = 'request_not_found' | 'request_expired' | 'request_completed' | 'workspace_required';

/** Body of POST /api/oauth/consent: the server's consentBodySchema type. */
export type { ConsentBody as ConsentDecisionBody } from '@/lib/oauth/consent';

export const CONSENT_POST_PATH = '/api/oauth/consent';
