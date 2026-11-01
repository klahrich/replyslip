import type { AgentChoice, ConsentDecisionBody, ConsentProblem, ConsentView } from './consent-types';

/** The fallback when the server's pattern can't be compiled: AGENT_NAME_PATTERN in lib/constants.ts. */
const AGENT_NAME_FALLBACK = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export type Selection = { mode: 'new' } | { mode: 'reconnect'; agentId: string };

/** New agent by default. At the plan's agent limit a new agent can't be made, so start on the newest reconnect choice. */
export function initialSelection(view: ConsentView): Selection {
  const first = view.agent.reconnect_options[0];
  if (view.plan.at_agent_limit && first) return { mode: 'reconnect', agentId: first.id };
  return { mode: 'new' };
}

function namePattern(source: string): RegExp {
  try {
    return new RegExp(source);
  } catch {
    return AGENT_NAME_FALLBACK;
  }
}

/** A short message when the agent name won't pass the server's check, or null when it looks fine. */
export function nameProblem(name: string, patternSource: string): string | null {
  const value = name.trim();
  if (!value) return 'Give the agent a name.';
  if (!namePattern(patternSource).test(value)) {
    return 'Use letters, numbers, - or _, starting with a letter. Up to 64 characters.';
  }
  return null;
}

/** Allow is possible for a valid new name under the limit, or for a listed reconnect choice. */
export function canAllow(view: ConsentView, selection: Selection, name: string): boolean {
  if (selection.mode === 'reconnect') return view.agent.reconnect_options.some((o) => o.id === selection.agentId);
  return !view.plan.at_agent_limit && nameProblem(name, view.agent.name_pattern) === null;
}

export function decisionBody(
  view: ConsentView,
  decision: 'allow' | 'deny',
  selection: Selection,
  name: string,
  workspaceId: string,
): ConsentDecisionBody {
  const base = { request_id: view.request_id, csrf_token: view.csrf_token, decision, workspace_id: workspaceId };
  if (decision === 'deny') return base;
  const agent: AgentChoice =
    selection.mode === 'reconnect' ? { mode: 'reconnect', agent_id: selection.agentId } : { mode: 'new', name: name.trim() };
  return { ...base, agent };
}

export type AppLabel = {
  /** What to call the app in sentences: its own name, in quotes when we can't confirm it. */
  name: string;
  /** The host shown under the name. */
  host: string;
  verified: boolean;
  /** Where the browser goes back to, when that differs from `host`. */
  returnsTo: string | null;
  /** The letter on the tile (no remote logos). */
  initial: string;
};

export function appLabel(view: ConsentView): AppLabel {
  const { client, redirect } = view;
  const host = client.verified && client.kind === 'cimd' ? client.display_name : redirect.host;
  const name = client.verified ? client.client_name : `“${client.client_name}”`;
  const initial = (client.client_name.trim().match(/[A-Za-z0-9]/)?.[0] ?? '?').toUpperCase();
  return { name, host, verified: client.verified, returnsTo: redirect.host !== host ? redirect.host : null, initial };
}

/** "Returning to ChatGPT…", or a neutral line for an app we can't confirm. */
export function returningText(view: ConsentView): string {
  return view.client.verified ? `Returning to ${view.client.client_name}…` : 'Returning to the app…';
}

export type PostOutcome =
  | { kind: 'redirect'; url: string }
  | { kind: 'problem'; problem: ConsentProblem }
  | { kind: 'error'; code: string; message: string; suggestedName?: string };

const PROBLEM_CODES: ConsentProblem[] = ['request_not_found', 'request_expired', 'request_completed', 'workspace_required'];

export function problemFromCode(code: string): ConsentProblem | null {
  return (PROBLEM_CODES as string[]).includes(code) ? (code as ConsentProblem) : null;
}

/** Turns the POST /api/oauth/consent answer into what the page does next. */
export function outcomeFromResponse(status: number, data: unknown): PostOutcome {
  if (status === 200) {
    const url = (data as { redirect_to?: unknown } | null)?.redirect_to;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return { kind: 'redirect', url };
    return { kind: 'error', code: 'bad_response', message: 'Something went wrong. Try again.' };
  }
  const err = (data as { error?: { code?: unknown; details?: unknown } } | null)?.error;
  const code = typeof err?.code === 'string' ? err.code : status === 429 ? 'rate_limited' : status === 401 ? 'unauthorized' : 'error';
  const problem = problemFromCode(code);
  if (problem) return { kind: 'problem', problem };
  switch (code) {
    case 'name_taken': {
      const suggested = (err?.details as { suggested_name?: unknown } | undefined)?.suggested_name;
      const suggestedName = typeof suggested === 'string' ? suggested : undefined;
      return {
        kind: 'error',
        code,
        message: suggestedName ? `That name is taken. We changed it to ${suggestedName}.` : 'That name is taken. Pick another.',
        suggestedName,
      };
    }
    case 'invalid_name':
    case 'validation_error':
      return { kind: 'error', code, message: 'Use letters, numbers, - or _, starting with a letter. Up to 64 characters.' };
    case 'plan_limit':
      return {
        kind: 'error',
        code,
        message: 'Your workspace is at its agent limit. Reconnect an existing agent, or remove one in your dashboard.',
      };
    case 'bad_origin':
    case 'csrf_failed':
    case 'binding_failed':
      return {
        kind: 'error',
        code,
        message: 'This request started in another browser or tab. Go back to the app and connect again from here.',
      };
    case 'unauthorized':
      return { kind: 'error', code, message: 'You were signed out. Reload this page to sign in again.' };
    case 'rate_limited':
      return { kind: 'error', code, message: 'Too many tries. Wait a few minutes and try again.' };
    default:
      return { kind: 'error', code, message: 'Something went wrong. Try again.' };
  }
}

export type ProblemCopy = { title: string; body: string; dashboard: boolean };

export function problemCopy(problem: ConsentProblem): ProblemCopy {
  switch (problem) {
    case 'request_expired':
      return {
        title: 'This request has expired',
        body: 'Requests last 20 minutes. Go back to the app and connect again.',
        dashboard: false,
      };
    case 'request_completed':
      return {
        title: 'This request is already answered',
        body: 'You already allowed or cancelled it. To connect again, start over from the app.',
        dashboard: false,
      };
    case 'workspace_required':
      return {
        title: 'You need a workspace first',
        body: 'Open your dashboard to finish setting up, then connect the app again.',
        dashboard: true,
      };
    default:
      return {
        title: 'This link doesn’t work',
        body: 'It may be incomplete, or it was opened in a different account. Go back to the app and connect again.',
        dashboard: false,
      };
  }
}
