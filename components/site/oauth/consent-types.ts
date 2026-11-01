/**
 * The consent page's side of the contract in docs/design/mcp-oauth.md §6.1–6.2. PlumberBot's server PR exports the
 * same `ConsentView` from lib/oauth/consent.ts; once it lands, these types re-export from there.
 */

export type ConsentView = {
  request_id: string;
  csrf_token: string;
  expires_at: string;
  client: {
    /** Verified apps: the host of the app's ID URL ("chatgpt.com"). Unverified apps: the name they gave. */
    display_name: string;
    /** The name the app gives itself, e.g. "ChatGPT". */
    client_name: string;
    verified: boolean;
    kind: 'cimd' | 'dcr';
    client_uri_host: string | null;
    /** Always null: the page never loads a remote logo. */
    logo_url: null;
  };
  redirect: { host: string; loopback: boolean };
  user: { email: string };
  workspaces: Array<{ id: string; name: string; handle: string | null }>;
  agent: {
    suggested_name: string;
    /** AGENT_NAME_PATTERN's source, for hints in the browser. The server checks again. */
    name_pattern: string;
    reconnect_options: Array<{ id: string; name: string; last_connected_at: string | null }>;
  };
  scope: { name: 'agent'; allows: string[]; denies: string[] };
  plan: { at_agent_limit: boolean; agent_limit: number | null };
};

/** Why the page can't show the request. Matches the HttpError codes loadConsentRequest throws. */
export type ConsentProblem = 'request_not_found' | 'request_expired' | 'request_completed' | 'workspace_required';

export type AgentChoice = { mode: 'new'; name: string } | { mode: 'reconnect'; agent_id: string };

/** Body of POST /api/oauth/consent. */
export type ConsentDecisionBody = {
  request_id: string;
  csrf_token: string;
  decision: 'allow' | 'deny';
  workspace_id: string;
  agent?: AgentChoice;
};

export const CONSENT_POST_PATH = '/api/oauth/consent';
